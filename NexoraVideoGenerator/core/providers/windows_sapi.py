"""Windows SAPI TTS provider."""

from __future__ import annotations

import base64
import subprocess
import wave
from pathlib import Path
from typing import Any, Dict, Mapping


class WindowsSapiTTSProvider:
    """Generate WAV audio using the local Windows SAPI voices."""

    def __init__(self, cfg: Mapping[str, Any]):
        tts_cfg = cfg.get("tts") if isinstance(cfg.get("tts"), dict) else {}
        self.voice = str(tts_cfg.get("voice") or "").strip()
        try:
            self.rate = int(tts_cfg.get("rate") or 0)
        except Exception:
            self.rate = 0
        self.rate = max(-10, min(self.rate, 10))

    def synthesize(self, text: str, output_path: Path) -> Dict[str, Any]:
        content = str(text or "").strip()
        if not content:
            raise ValueError("TTS 文本不能为空")
        output_path.parent.mkdir(parents=True, exist_ok=True)
        text_path = output_path.with_suffix(".tts.txt")
        text_path.write_text(content, encoding="utf-8-sig")

        command = (
            "Add-Type -AssemblyName System.Speech; "
            "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
            f"$s.Rate = {self.rate}; "
            f"$text = Get-Content -LiteralPath '{_ps_single(str(text_path))}' -Raw -Encoding UTF8; "
        )
        if self.voice:
            command += f"$s.SelectVoice('{_ps_single(self.voice)}'); "
        command += (
            f"$s.SetOutputToWaveFile('{_ps_single(str(output_path))}'); "
            "$s.Speak($text); "
            "$s.Dispose();"
        )
        encoded_command = base64.b64encode(command.encode("utf-16-le")).decode("ascii")
        result = subprocess.run(
            ["powershell", "-NoProfile", "-EncodedCommand", encoded_command],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=180,
        )
        if result.returncode != 0:
            raise RuntimeError((result.stderr or result.stdout or "Windows SAPI TTS failed").strip())

        return {
            "path": str(output_path),
            "duration": _wav_duration(output_path),
            "voice": self.voice,
            "rate": self.rate,
        }


def _ps_single(value: str) -> str:
    return str(value or "").replace("'", "''")


def _wav_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as reader:
        frames = reader.getnframes()
        rate = reader.getframerate()
        if rate <= 0:
            raise ValueError("invalid wav sample rate")
        return float(frames) / float(rate)
