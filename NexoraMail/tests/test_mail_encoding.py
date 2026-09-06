import base64
import os
import pathlib
import sys
import tempfile
import unittest

NEXORA_MAIL_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(NEXORA_MAIL_ROOT))

from api.server import _extract_mail_content, _load_mail_entry
from core.SMTPService import _mail_payload_to_bytes


class MailEncodingTests(unittest.TestCase):
    @staticmethod
    def make_message(body, content_type='text/plain', transfer_encoding='8bit', subject=None):
        crlf = chr(13) + chr(10)
        subject_line = subject or 'Delivery report: succeeded'
        payload = body

        if transfer_encoding == 'base64':
            payload = base64.b64encode(body.encode('utf-8')).decode('ascii')

        return crlf.join(
            [
                'From: noreply@himpqblog.cn',
                'To: user@example.com',
                f'Subject: {subject_line}',
                'MIME-Version: 1.0',
                f'Content-Type: {content_type}; charset=UTF-8',
                f'Content-Transfer-Encoding: {transfer_encoding}',
                '',
                payload,
            ]
        )

    def test_direct_utf8_8bit_body_is_preserved(self):
        expected = chr(0x306E) + chr(0x535A) + chr(0x5BA2)
        parsed = _extract_mail_content(self.make_message(expected).encode('utf-8'))

        self.assertEqual(parsed['content_text'], expected)
        self.assertEqual(parsed['preview_text'], expected)

    def test_literal_unicode_escapes_are_decoded_in_text_and_subject(self):
        slash = chr(92)
        literal = slash + 'u306E' + slash + 'u535A' + slash + 'u5BA2'
        expected = chr(0x306E) + chr(0x535A) + chr(0x5BA2)
        parsed = _extract_mail_content(
            self.make_message(literal, subject=literal).encode('utf-8')
        )

        self.assertEqual(parsed['subject'], expected)
        self.assertEqual(parsed['content_text'], expected)
        self.assertEqual(parsed['preview_text'], expected)

    def test_base64_literal_unicode_escapes_are_decoded(self):
        slash = chr(92)
        literal = slash + 'u306E' + slash + 'u535A' + slash + 'u5BA2'
        expected = chr(0x306E) + chr(0x535A) + chr(0x5BA2)
        parsed = _extract_mail_content(
            self.make_message(literal, transfer_encoding='base64').encode('utf-8')
        )

        self.assertEqual(parsed['content_text'], expected)

    def test_html_body_is_normalized_and_converted_to_text(self):
        expected = chr(0x306E) + chr(0x535A) + chr(0x5BA2)
        html = '<html><body><p>' + expected + '</p></body></html>'
        parsed = _extract_mail_content(
            self.make_message(html, content_type='text/html').encode('utf-8')
        )

        self.assertEqual(parsed['content_html'], html)
        self.assertEqual(parsed['content_text'], expected)

    def test_file_payload_is_copied_without_reencoding(self):
        payload = bytes([0x46, 0x80, 0x81, 0xFE, 0xFF])
        path = None

        try:
            with tempfile.NamedTemporaryFile(delete=False) as payload_file:
                path = payload_file.name
                payload_file.write(payload)

            self.assertEqual(_mail_payload_to_bytes(path), payload)
        finally:
            if path and os.path.exists(path):
                os.unlink(path)

    def test_mail_entry_parses_binary_content_and_keeps_raw_response(self):
        expected = chr(0x306E) + chr(0x535A) + chr(0x5BA2)
        raw = self.make_message(expected).encode('utf-8')

        with tempfile.TemporaryDirectory() as mail_dir:
            pathlib.Path(mail_dir, 'mail.json').write_text(
                '{"id":"encoding-test","sender":"noreply@himpqblog.cn",'
                '"recipient":"user@example.com","timestamp":1}',
                encoding='utf-8',
            )
            pathlib.Path(mail_dir, 'content.txt').write_bytes(raw)

            parsed = _load_mail_entry(mail_dir, include_content=True)

        self.assertEqual(parsed['id'], 'encoding-test')
        self.assertEqual(parsed['content_text'], expected)
        self.assertEqual(parsed['content'], raw.decode('utf-8'))


if __name__ == '__main__':
    unittest.main()
