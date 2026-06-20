from __future__ import annotations

from .models import AntiSpiderState


class AntiSpiderDetector:
    """用多种页面信号识别人机验证，避免把验证页面当作空结果。"""

    URL_MARKERS = (
        "/captcha",
        "captcha",
        "challenge",
        "verify",
        "checkpoint",
        "account.microsoft.com",
    )

    TEXT_MARKERS = (
        "verify you are human",
        "unusual traffic",
        "complete the challenge",
        "captcha",
        "robot",
        "人机验证",
        "安全验证",
        "请完成验证",
        "异常流量",
    )

    FRAME_MARKERS = (
        "recaptcha",
        "hcaptcha",
        "turnstile",
        "arkoselabs",
        "geetest",
        "captcha",
    )

    def detect_page(self, page) -> AntiSpiderState:
        current_url = self._read_page_value(lambda: page.url)
        title = self._read_page_value(lambda: page.title())
        lower_url = current_url.lower()

        for marker in self.URL_MARKERS:

            if marker in lower_url:
                return AntiSpiderState(True, f"url_marker:{marker}", current_url, title)

        frame_reason = self._detect_frame_marker(page)

        if frame_reason:
            return AntiSpiderState(True, frame_reason, current_url, title)

        text_reason = self._detect_text_marker(page)

        if text_reason:
            return AntiSpiderState(True, text_reason, current_url, title)

        return AntiSpiderState(False, "", current_url, title)

    def _detect_frame_marker(self, page) -> str:
        frame_sources = page.evaluate(
            """
            () => Array.from(document.querySelectorAll('iframe'))
                .map((frame) => frame.getAttribute('src') || '')
                .join('\\n')
            """
        )
        lower_sources = str(frame_sources or "").lower()

        for marker in self.FRAME_MARKERS:

            if marker in lower_sources:
                return f"frame_marker:{marker}"

        return ""

    def _detect_text_marker(self, page) -> str:
        visible_text = page.evaluate(
            """
            () => {
                const body = document.body;

                if (!body) {
                    return '';
                }

                return body.innerText.slice(0, 12000);
            }
            """
        )
        lower_text = str(visible_text or "").lower()

        for marker in self.TEXT_MARKERS:

            if marker.lower() in lower_text:
                return f"text_marker:{marker}"

        return ""

    def _read_page_value(self, reader) -> str:
        try:
            return str(reader() or "")
        except Exception:
            return ""
