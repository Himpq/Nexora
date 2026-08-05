"""Persistent health polling for the public service-status page."""

from __future__ import annotations

import threading
import time
from datetime import datetime
from typing import Any, Callable, Dict, List, Mapping, Sequence

from datastorage import get_path_lock, safe_read_json, safe_write_json
from api.testapi import ServiceHealthTester


class ServiceStatusMonitor:
    """Poll enabled services and expose a public, credential-free status snapshot."""

    SAMPLE_RETENTION_SECONDS = 24 * 60 * 60
    HISTORY_HOURS = 24

    def __init__(
        self,
        config_loader: Callable[[], Mapping[str, Any]],
        storage_path: str,
        *,
        interval_seconds: int = 60,
    ) -> None:
        self._config_loader = config_loader
        self._storage_path = str(storage_path)
        self._interval_seconds = max(15, int(interval_seconds))
        self._lock = threading.RLock()
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._snapshot: Dict[str, Any] = self._empty_snapshot()

    def start(self) -> None:
        """Start one daemon poller and make an initial snapshot available immediately."""
        with self._lock:
            if self._thread and self._thread.is_alive():
                return

            self._stop_event.clear()
            self.refresh()
            self._thread = threading.Thread(
                target=self._poll_forever,
                name="ServiceStatusMonitor",
                daemon=True,
            )
            self._thread.start()

    def stop(self) -> None:
        """Request a clean stop for test and process-shutdown callers."""
        self._stop_event.set()

    def overview(self) -> Dict[str, Any]:
        """Return a copy of the latest public snapshot without probe internals."""
        with self._lock:
            return {
                "snapshotAt": str(self._snapshot.get("snapshotAt") or ""),
                "services": [dict(item) for item in self._snapshot.get("services", [])],
            }

    def refresh(self) -> Dict[str, Any]:
        """Probe all currently enabled services and persist their rolling 24-hour samples."""
        checked_at = time.time()
        services = self._collect_services(self._config_loader())
        current_rows = [self._probe_service(service, checked_at) for service in services]

        with self._lock:
            history = self._read_history()
            history_services = history.setdefault("services", {})

            for current in current_rows:
                service_id = current["id"]
                service_history = history_services.setdefault(service_id, {"samples": []})
                samples = service_history.get("samples")

                if not isinstance(samples, list):
                    samples = []

                previous_status = self._latest_status(samples)
                samples.append({
                    "at": checked_at,
                    "status": current["status"],
                })
                service_history["samples"] = self._trim_samples(samples, checked_at)

                if previous_status != current["status"]:
                    print(
                        "[ServiceStatusMonitor] "
                        f"service={service_id} status={previous_status or 'initial'}->{current['status']}"
                    )

            history["updatedAt"] = checked_at
            self._write_history(history)
            self._snapshot = self._build_snapshot(current_rows, history_services, checked_at)
            return self.overview()

    def _poll_forever(self) -> None:
        while not self._stop_event.wait(self._interval_seconds):
            try:
                self.refresh()
            except Exception as exc:
                print(f"[ServiceStatusMonitor] refresh failed: {exc}")

    def _collect_services(self, config: Mapping[str, Any]) -> List[Dict[str, Any]]:
        cfg = dict(config or {})
        services = [{
            "id": "chatdb",
            "name": "Nexora",
            "description": "主聊天与公共站点",
            "kind": "upstream",
            "service_name": "Nexora",
            "service_url": self._main_service_url(cfg),
            "health_path": "/api/health",
        }]

        learning = self._mapping(cfg.get("nexora_learning"))

        if bool(learning.get("enabled", True)):
            services.append({
                "id": "nexora_learning",
                "name": "NexoraLearning",
                "description": "个性化学习服务",
                "kind": "upstream",
                "service_name": "NexoraLearning",
                "service_url": self._learning_service_url(learning),
                "health_path": "/health",
            })

        rag = self._mapping(cfg.get("rag_database"))

        if bool(rag.get("rag_database_enabled", False)) and str(rag.get("mode") or "service") == "service":
            services.append({
                "id": "nexora_db",
                "name": "NexoraDB",
                "description": "向量检索服务",
                "kind": "upstream",
                "service_name": "NexoraDB",
                "service_url": self._service_url(rag),
                "health_path": "/health",
            })

        search = self._mapping(cfg.get("nexora_search"))

        if bool(search.get("nexora_search_enabled", False)):
            services.append({
                "id": "nexora_search",
                "name": "NexoraSearch",
                "description": "联网检索服务",
                "kind": "upstream",
                "service_name": "NexoraSearch",
                "service_url": self._service_url(search),
                "health_path": "/health",
            })

        mail = self._mapping(cfg.get("nexora_mail"))

        if bool(mail.get("nexora_mail_enabled", False)):
            services.append({
                "id": "nexora_mail",
                "name": "NexoraMail",
                "description": "邮件服务",
                "kind": "upstream",
                "service_name": "NexoraMail",
                "service_url": self._service_url(mail),
                "health_path": "/api/health",
            })

        return services

    def _probe_service(self, service: Mapping[str, Any], checked_at: float) -> Dict[str, Any]:
        payload = {
            "service_url": str(service.get("service_url") or ""),
            "health_path": str(service.get("health_path") or ""),
        }
        result, _ = ServiceHealthTester(str(service.get("service_name") or ""), payload).run(record_log=False)
        status = "operational" if bool(result.get("success")) else "outage"

        return {
            "id": str(service["id"]),
            "name": str(service["name"]),
            "description": str(service["description"]),
            "status": status,
            "checkedAt": self._format_timestamp(checked_at),
            "latencyMs": self._latency_ms(result.get("elapsed_ms")),
        }

    def _build_snapshot(
        self,
        current_rows: Sequence[Mapping[str, Any]],
        history_services: Mapping[str, Any],
        checked_at: float,
    ) -> Dict[str, Any]:
        services = []

        for current in current_rows:
            service_history = self._mapping(history_services.get(str(current["id"])))
            samples = self._trim_samples(service_history.get("samples", []), checked_at)
            history24h = self._history_cells(samples, checked_at)
            known_samples = [sample for sample in samples if str(sample.get("status") or "") != "unknown"]
            operational_samples = [sample for sample in known_samples if sample.get("status") == "operational"]
            uptime = None

            if known_samples:
                uptime = round((len(operational_samples) / len(known_samples)) * 100, 2)

            services.append({
                **dict(current),
                "uptime24h": uptime,
                "history24h": history24h,
                "recentSamples": self._recent_samples(samples),
                "sampleCount24h": len(known_samples),
            })

        return {
            "snapshotAt": self._format_timestamp(checked_at),
            "services": services,
        }

    def _history_cells(self, samples: Sequence[Mapping[str, Any]], checked_at: float) -> List[str]:
        cells = []
        start_at = checked_at - self.SAMPLE_RETENTION_SECONDS

        for index in range(self.HISTORY_HOURS):
            slot_start = start_at + index * 60 * 60
            slot_end = slot_start + 60 * 60
            slot_samples = [
                str(sample.get("status") or "unknown")
                for sample in samples
                if slot_start <= float(sample.get("at") or 0) < slot_end
            ]
            cells.append(self._worst_status(slot_samples))

        return cells

    @staticmethod
    def _recent_samples(samples: Sequence[Mapping[str, Any]]) -> List[str]:
        return [
            str(sample.get("status") or "unknown")
            for sample in samples[-60:]
        ]

    def _read_history(self) -> Dict[str, Any]:
        with get_path_lock(self._storage_path):
            payload = safe_read_json(self._storage_path, default={}, ensure_dict=True)

        if not isinstance(payload, dict):
            raise ValueError("service status history must be a JSON object")

        services = payload.get("services")

        if not isinstance(services, dict):
            payload["services"] = {}

        return payload

    def _write_history(self, payload: Mapping[str, Any]) -> None:
        with get_path_lock(self._storage_path):
            safe_write_json(self._storage_path, dict(payload), backup=False)

    @classmethod
    def _trim_samples(cls, raw_samples: Any, checked_at: float) -> List[Dict[str, Any]]:
        if not isinstance(raw_samples, list):
            return []

        earliest = checked_at - cls.SAMPLE_RETENTION_SECONDS
        samples = []

        for sample in raw_samples:
            if not isinstance(sample, dict):
                continue

            try:
                sampled_at = float(sample.get("at"))
            except (TypeError, ValueError):
                continue

            if sampled_at < earliest or sampled_at > checked_at:
                continue

            samples.append({
                "at": sampled_at,
                "status": cls._normalize_status(sample.get("status")),
            })

        return samples

    @staticmethod
    def _worst_status(statuses: Sequence[str]) -> str:
        if not statuses:
            return "unknown"

        if "outage" in statuses:
            return "outage"

        if "degraded" in statuses:
            return "degraded"

        if "operational" in statuses:
            return "operational"

        return "unknown"

    @classmethod
    def _latest_status(cls, raw_samples: Any) -> str:
        if not isinstance(raw_samples, list):
            return ""

        for sample in reversed(raw_samples):
            if isinstance(sample, dict):
                return cls._normalize_status(sample.get("status"))

        return ""

    @staticmethod
    def _normalize_status(value: Any) -> str:
        status = str(value or "unknown").strip().lower()
        return status if status in {"operational", "degraded", "outage"} else "unknown"

    @staticmethod
    def _mapping(value: Any) -> Dict[str, Any]:
        return dict(value) if isinstance(value, Mapping) else {}

    @staticmethod
    def _service_url(config: Mapping[str, Any]) -> str:
        service_url = str(config.get("service_url") or "").strip().rstrip("/")

        if service_url:
            return service_url

        host = str(config.get("host") or "").strip()
        port = config.get("port")

        if not host or port in (None, ""):
            return ""

        return f"http://{host}:{int(port)}"

    @staticmethod
    def _main_service_url(config: Mapping[str, Any]) -> str:
        try:
            port = int(config.get("port") or 5000)
        except (TypeError, ValueError):
            port = 5000

        return f"http://127.0.0.1:{port}"

    @classmethod
    def _learning_service_url(cls, config: Mapping[str, Any]) -> str:
        service_url = str(config.get("frontend_url") or "").strip().rstrip("/")

        for suffix in ("/api/frontend", "/api/runtime"):
            if service_url.endswith(suffix):
                service_url = service_url[:-len(suffix)]

        return service_url or cls._service_url(config)

    @staticmethod
    def _format_timestamp(timestamp: float) -> str:
        return datetime.fromtimestamp(timestamp).strftime("%Y-%m-%d %H:%M:%S")

    @staticmethod
    def _latency_ms(value: Any) -> int | None:
        try:
            return max(0, int(value))
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _empty_snapshot() -> Dict[str, Any]:
        return {"snapshotAt": "", "services": []}
