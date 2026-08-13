import json
import socket
import ssl
import time
from typing import Any, Callable, Dict, Optional, Tuple
from urllib import error as urllib_error, parse as urllib_parse, request as urllib_request

import certifi
from flask import Blueprint, jsonify, request

from App.Utils import log_event


class ServiceHealthTester:
    """由 ChatDB 服务端发起外部服务 health 测试。"""

    SERVICE_SPECS = {
        "Nexora": {
            "label": "Nexora",
            "default_health_path": "/api/health",
            "default_timeout": 5.0,
        },
        "NexoraDB": {
            "label": "NexoraDB",
            "default_health_path": "/health",
            "default_timeout": 8.0,
        },
        "NexoraSearch": {
            "label": "NexoraSearch",
            "default_health_path": "/health",
            "default_timeout": 15.0,
        },
        "NexoraLearning": {
            "label": "NexoraLearning",
            "default_health_path": "/health",
            "default_timeout": 15.0,
        },
        "NexoraMail": {
            "label": "NexoraMail",
            "default_health_path": "/api/health",
            "default_timeout": 10.0,
        },
    }

    def __init__(self, service_name: str, payload: Dict[str, Any]):
        self.service_name = str(service_name or "").strip()
        self.payload = payload if isinstance(payload, dict) else {}
        self.spec = self.SERVICE_SPECS.get(self.service_name)

    def run(self, *, record_log: bool = True) -> Tuple[Dict[str, Any], int]:
        started_at = time.perf_counter()

        try:
            self._validate_service_name()
            timeout = self._resolve_timeout()
            target_url = self._build_health_url()
            response_payload, status_code = self._request_health(target_url, timeout, started_at)
        except ValueError as exc:
            response_payload = self._build_error_payload(str(exc), "invalid_config", started_at)
            status_code = 400
        except urllib_error.HTTPError as exc:
            response_payload = self._build_http_error_payload(exc, started_at)
            status_code = 502
        except urllib_error.URLError as exc:
            response_payload = self._build_error_payload(
                self._format_url_error(exc),
                self._resolve_url_error_type(exc),
                started_at,
            )
            status_code = 502
        except socket.timeout as exc:
            response_payload = self._build_error_payload(str(exc) or "服务端测试超时", "timeout", started_at)
            status_code = 504

        if record_log:
            self._write_test_log(response_payload)
        return response_payload, status_code

    def _validate_service_name(self) -> None:
        if self.spec is None:
            raise ValueError(f"未知测试服务: {self.service_name or '-'}")

    def _resolve_timeout(self) -> float:
        raw_timeout = self.payload.get("timeout")

        if raw_timeout in (None, ""):
            return float(self.spec["default_timeout"])

        try:
            timeout = float(raw_timeout)
        except (TypeError, ValueError) as exc:
            raise ValueError("测试超时必须是数字") from exc

        if timeout < 1 or timeout > 60:
            raise ValueError("测试超时必须在 1-60 秒之间")

        return timeout

    def _build_health_url(self) -> str:
        service_url = str(self.payload.get("service_url") or "").strip().rstrip("/")
        health_path = str(self.payload.get("health_path") or self.spec["default_health_path"]).strip()

        if not service_url:
            raise ValueError("Service URL 不能为空")

        if not health_path.startswith("/"):
            raise ValueError("Health Path 必须以 / 开头")

        parsed = urllib_parse.urlsplit(service_url)

        if parsed.scheme not in ("http", "https"):
            raise ValueError("Service URL 必须以 http:// 或 https:// 开头")

        if not parsed.netloc:
            raise ValueError("Service URL 缺少主机")

        base_path = parsed.path.rstrip("/")
        target_path = f"{base_path}{health_path}"

        return urllib_parse.urlunsplit((parsed.scheme, parsed.netloc, target_path, "", ""))

    def _request_health(self, target_url: str, timeout: float, started_at: float) -> Tuple[Dict[str, Any], int]:
        target_scheme = urllib_parse.urlsplit(target_url).scheme
        req = urllib_request.Request(
            target_url,
            headers={
                "Accept": "application/json,text/plain,*/*",
                "User-Agent": "ChatDB-ServiceHealthTester/1.0",
            },
            method="GET",
        )
        urlopen_kwargs = {"timeout": timeout}

        if target_scheme == "https":
            urlopen_kwargs["context"] = self._build_ssl_context()

        with urllib_request.urlopen(req, **urlopen_kwargs) as resp:
            raw_body = resp.read(65536)
            body_text = self._decode_body(raw_body)
            upstream_payload = self._parse_json_body(body_text)
            upstream_status = int(getattr(resp, "status", 200) or 200)
            content_type = str(resp.headers.get("Content-Type") or "").strip()
            elapsed_ms = self._elapsed_ms(started_at)

        success = 200 <= upstream_status < 300
        message = f"{self.spec['label']} 服务正常"

        if isinstance(upstream_payload, dict) and upstream_payload.get("success") is False:
            success = False
            message = str(upstream_payload.get("message") or upstream_payload.get("error") or f"{self.spec['label']} health 返回失败")

        payload = {
            "success": success,
            "message": message,
            "service": self.service_name,
            "test_url": target_url,
            "upstream_status": upstream_status,
            "upstream_content_type": content_type,
            "upstream": upstream_payload,
            "upstream_preview": body_text[:1000],
            "tls_ca_bundle": "certifi" if target_scheme == "https" else None,
            "elapsed_ms": elapsed_ms,
        }

        return payload, 200 if success else 502

    def _build_http_error_payload(self, exc: urllib_error.HTTPError, started_at: float) -> Dict[str, Any]:
        body_text = self._read_http_error_body(exc)
        upstream_payload = self._parse_json_body(body_text)

        return {
            **self._build_error_payload(f"上游 health 返回 HTTP {exc.code}", "http_error", started_at),
            "upstream_status": int(exc.code),
            "upstream": upstream_payload,
            "upstream_preview": body_text[:1000],
        }

    def _build_error_payload(self, message: str, error_type: str, started_at: float) -> Dict[str, Any]:
        return {
            "success": False,
            "message": message,
            "service": self.service_name,
            "error_type": error_type,
            "elapsed_ms": self._elapsed_ms(started_at),
        }

    def _write_test_log(self, payload: Dict[str, Any]) -> None:
        log_event(
            "service_health_test",
            f"{self.service_name or '-'} health test",
            payload={
                "service": self.service_name,
                "success": bool(payload.get("success")),
                "message": str(payload.get("message") or ""),
                "test_url": str(payload.get("test_url") or ""),
                "upstream_status": payload.get("upstream_status"),
                "error_type": payload.get("error_type"),
                "tls_ca_bundle": payload.get("tls_ca_bundle"),
                "elapsed_ms": payload.get("elapsed_ms"),
            },
            source="testapi",
        )

    @staticmethod
    def _build_ssl_context() -> ssl.SSLContext:
        """使用 certifi 的 CA 证书包校验外部 HTTPS 服务。"""
        return ssl.create_default_context(cafile=certifi.where())

    @staticmethod
    def _decode_body(raw_body: bytes) -> str:
        if not raw_body:
            return ""

        return raw_body.decode("utf-8", errors="replace")

    @staticmethod
    def _parse_json_body(body_text: str) -> Optional[Any]:
        text = str(body_text or "").strip()

        if not text:
            return None

        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return None

    @staticmethod
    def _read_http_error_body(exc: urllib_error.HTTPError) -> str:
        try:
            return ServiceHealthTester._decode_body(exc.read(65536))
        except Exception:
            return ""

    @staticmethod
    def _format_url_error(exc: urllib_error.URLError) -> str:
        reason = getattr(exc, "reason", None)

        if ServiceHealthTester._is_tls_verify_error(exc):
            return f"服务端无法验证 health 接口证书: {reason}"

        if reason:
            return f"服务端无法连接 health 接口: {reason}"

        return f"服务端无法连接 health 接口: {exc}"

    @staticmethod
    def _resolve_url_error_type(exc: urllib_error.URLError) -> str:
        if ServiceHealthTester._is_tls_verify_error(exc):
            return "tls_certificate_error"

        return "network_error"

    @staticmethod
    def _is_tls_verify_error(exc: urllib_error.URLError) -> bool:
        reason = getattr(exc, "reason", exc)

        if isinstance(reason, ssl.SSLCertVerificationError):
            return True

        reason_text = str(reason)

        return "CERTIFICATE_VERIFY_FAILED" in reason_text or "certificate verify failed" in reason_text.lower()

    @staticmethod
    def _elapsed_ms(started_at: float) -> int:
        return int((time.perf_counter() - started_at) * 1000)


def create_testapi_blueprint(require_admin: Callable) -> Blueprint:
    testapi_bp = Blueprint("testapi", __name__)

    @testapi_bp.route("/api/test/<service_name>", methods=["POST"])
    @require_admin
    def test_service_health(service_name: str):
        payload = request.get_json(silent=True) or {}
        result, status_code = ServiceHealthTester(service_name, payload).run()

        return jsonify(result), status_code

    return testapi_bp
