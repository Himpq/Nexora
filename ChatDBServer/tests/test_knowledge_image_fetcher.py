import socket
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

SERVER_DIR = Path(__file__).resolve().parents[1]
API_DIR = SERVER_DIR / "api"

if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from App.Files.knowledge_image_fetcher import (
    KnowledgeImageFetcher,
    _PinnedHTTPConnection,
    _PinnedHTTPSConnection,
)


def _address_info(address, family=socket.AF_INET):
    if family == socket.AF_INET6:
        sockaddr = (address, 443, 0, 0)
    else:
        sockaddr = (address, 80)

    return (family, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", sockaddr)


class _FakeResponse:
    def __init__(self, status, headers=None, body=b""):
        self.status = status
        self._headers = headers or {}
        self._body = body

    def getheader(self, name):
        return self._headers.get(name)

    def read(self, size):
        return self._body[:size]

    def close(self):
        pass


class _FakeConnection:
    def __init__(self, response):
        self.response = response
        self.request_args = None
        self.closed = False

    def request(self, method, target, headers):
        self.request_args = (method, target, headers)

    def getresponse(self):
        return self.response

    def close(self):
        self.closed = True


class KnowledgeImageFetcherTests(unittest.TestCase):
    def _fetch(self, url):
        return KnowledgeImageFetcher.fetch(
            url,
            max_bytes=16,
            allowed_mime_types={"image/png", "image/jpeg"},
        )

    def test_rejects_non_http_schemes_and_credentials(self):
        with patch("App.Files.knowledge_image_fetcher.socket.getaddrinfo") as resolve:
            with self.assertRaisesRegex(ValueError, "only http/https"):
                self._fetch("file:///etc/passwd")

            with self.assertRaisesRegex(ValueError, "invalid source_url"):
                self._fetch("https://user:password@example.com/image.png")

        resolve.assert_not_called()

    def test_rejects_private_or_mixed_dns_answers_before_connecting(self):
        cases = [
            [_address_info("127.0.0.1")],
            [_address_info("93.184.216.34"), _address_info("10.0.0.8")],
            [_address_info("fe80::1", socket.AF_INET6)],
            [_address_info("64:ff9b::7f00:1", socket.AF_INET6)],
        ]

        for answers in cases:
            with self.subTest(answers=answers):
                with patch(
                    "App.Files.knowledge_image_fetcher.socket.getaddrinfo",
                    return_value=answers,
                ), patch.object(KnowledgeImageFetcher, "_create_connection") as connect:
                    with self.assertRaisesRegex(ValueError, "public IP"):
                        self._fetch("https://images.example.com/image.png")

                connect.assert_not_called()

    def test_fetches_from_validated_address_and_keeps_request_target(self):
        response = _FakeResponse(
            200,
            {"Content-Type": "image/png; charset=binary"},
            b"image-bytes",
        )
        connection = _FakeConnection(response)

        with patch(
            "App.Files.knowledge_image_fetcher.socket.getaddrinfo",
            return_value=[_address_info("93.184.216.34")],
        ), patch.object(
            KnowledgeImageFetcher,
            "_create_connection",
            return_value=connection,
        ) as create_connection:
            result = self._fetch("https://images.example.com/picture.png?size=small")

        self.assertEqual(result, ("image/png", b"image-bytes"))
        create_connection.assert_called_once()
        self.assertEqual(
            create_connection.call_args.args[1:3],
            ("images.example.com", "93.184.216.34"),
        )
        self.assertEqual(
            connection.request_args[:2],
            ("GET", "/picture.png?size=small"),
        )
        self.assertTrue(connection.closed)

    def test_revalidates_redirect_target_before_connecting(self):
        response = _FakeResponse(302, {"Location": "http://127.0.0.1/internal"})
        connection = _FakeConnection(response)

        def resolve(host, port, type):
            if host == "images.example.com":
                return [_address_info("93.184.216.34")]

            return [_address_info("127.0.0.1")]

        with patch(
            "App.Files.knowledge_image_fetcher.socket.getaddrinfo",
            side_effect=resolve,
        ), patch.object(
            KnowledgeImageFetcher,
            "_create_connection",
            return_value=connection,
        ) as create_connection:
            with self.assertRaisesRegex(ValueError, "public IP"):
                self._fetch("https://images.example.com/redirect.png")

        create_connection.assert_called_once()
        self.assertTrue(connection.closed)

    def test_connection_uses_the_validated_ip_instead_of_resolving_host_again(self):
        raw_socket = Mock()
        connection = _PinnedHTTPConnection(
            "images.example.com",
            "93.184.216.34",
            80,
            15,
        )

        with patch(
            "App.Files.knowledge_image_fetcher.socket.create_connection",
            return_value=raw_socket,
        ) as create_socket:
            connection.connect()

        create_socket.assert_called_once_with(("93.184.216.34", 80), 15, None)
        self.assertIs(connection.sock, raw_socket)
        connection.close()

    def test_https_keeps_original_host_for_certificate_verification(self):
        raw_socket = Mock()
        tls_socket = Mock()
        context = Mock()
        context.wrap_socket.return_value = tls_socket

        with patch(
            "App.Files.knowledge_image_fetcher.ssl.create_default_context",
            return_value=context,
        ), patch(
            "App.Files.knowledge_image_fetcher.socket.create_connection",
            return_value=raw_socket,
        ) as create_socket:
            connection = _PinnedHTTPSConnection(
                "images.example.com",
                "93.184.216.34",
                443,
                15,
            )
            connection.connect()

        create_socket.assert_called_once_with(("93.184.216.34", 443), 15, None)
        context.wrap_socket.assert_called_once_with(
            raw_socket,
            server_hostname="images.example.com",
        )
        self.assertIs(connection.sock, tls_socket)
        connection.close()

    def test_rejects_response_larger_than_configured_limit(self):
        response = _FakeResponse(200, {"Content-Type": "image/png"}, b"x" * 17)
        connection = _FakeConnection(response)

        with patch(
            "App.Files.knowledge_image_fetcher.socket.getaddrinfo",
            return_value=[_address_info("93.184.216.34")],
        ), patch.object(
            KnowledgeImageFetcher,
            "_create_connection",
            return_value=connection,
        ):
            with self.assertRaisesRegex(ValueError, "image too large"):
                self._fetch("https://images.example.com/picture.png")

    def test_rejects_unsupported_content_type_without_extension_guessing(self):
        response = _FakeResponse(200, {"Content-Type": "text/html"}, b"not-an-image")
        connection = _FakeConnection(response)

        with patch(
            "App.Files.knowledge_image_fetcher.socket.getaddrinfo",
            return_value=[_address_info("93.184.216.34")],
        ), patch.object(
            KnowledgeImageFetcher,
            "_create_connection",
            return_value=connection,
        ):
            with self.assertRaisesRegex(ValueError, "unsupported source image mime"):
                self._fetch("https://images.example.com/picture.png")


if __name__ == "__main__":
    unittest.main()
