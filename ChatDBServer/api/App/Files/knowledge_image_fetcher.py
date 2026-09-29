import http.client
import ipaddress
import socket
import ssl
from typing import Iterable, Tuple
from urllib import parse as urllib_parse


_WELL_KNOWN_NAT64_PREFIX = ipaddress.ip_network("64:ff9b::/96")


class _PinnedHTTPConnection(http.client.HTTPConnection):
    """Connect to a validated address while retaining the original Host header."""

    def __init__(self, host: str, address: str, port: int, timeout: int):
        super().__init__(host=host, port=port, timeout=timeout)
        self._validated_address = address

    def connect(self) -> None:
        self.sock = socket.create_connection(
            (self._validated_address, self.port),
            self.timeout,
            self.source_address,
        )

        if self._tunnel_host:
            self._tunnel()


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    """Connect to a validated address and verify TLS against the original host."""

    def __init__(self, host: str, address: str, port: int, timeout: int):
        context = ssl.create_default_context()
        super().__init__(host=host, port=port, timeout=timeout, context=context)
        self._validated_address = address

    def connect(self) -> None:
        sock = socket.create_connection(
            (self._validated_address, self.port),
            self.timeout,
            self.source_address,
        )

        if self._tunnel_host:
            self.sock = sock
            self._tunnel()
            sock = self.sock

        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


class KnowledgeImageFetcher:
    """Fetch an image from a public HTTP(S) host without following unsafe redirects."""

    timeout_seconds = 15
    max_redirects = 5
    user_agent = "NexoraKnowledgeImageFetcher/1.0"

    @classmethod
    def fetch(
        cls,
        source_url: str,
        *,
        max_bytes: int,
        allowed_mime_types: Iterable[str],
    ) -> Tuple[str, bytes]:
        raw_url = str(source_url or "").strip()

        if not raw_url:
            raise ValueError("source_url is required")

        allowed_types = set(allowed_mime_types)
        current_url = raw_url

        for redirect_count in range(cls.max_redirects + 1):
            parsed_url, host, port = cls._parse_url(current_url)
            address = cls._resolve_public_address(host, port)
            connection = cls._create_connection(parsed_url, host, address, port)

            try:
                request_target = cls._build_request_target(parsed_url)
                connection.request(
                    "GET",
                    request_target,
                    headers={
                        "User-Agent": cls.user_agent,
                        "Connection": "close",
                    },
                )
                response = connection.getresponse()

                try:
                    if response.status in (301, 302, 303, 307, 308):
                        location = response.getheader("Location")

                        if not location:
                            raise ValueError("image source returned a redirect without a location")

                        if redirect_count >= cls.max_redirects:
                            raise ValueError("too many image source redirects")

                        current_url = urllib_parse.urljoin(current_url, location)
                        continue

                    if response.status < 200 or response.status >= 300:
                        raise ValueError(f"image source returned HTTP {response.status}")

                    content_type = str(response.getheader("Content-Type") or "")
                    content_type = content_type.split(";", 1)[0].strip().lower()
                    raw = response.read(max_bytes + 1)
                finally:
                    response.close()
            except ValueError:
                raise
            except Exception as error:
                raise ValueError("download failed") from error
            finally:
                connection.close()

            if len(raw) > max_bytes:
                raise ValueError(f"image too large (max {max_bytes} bytes)")

            if content_type not in allowed_types:
                raise ValueError("unsupported source image mime")

            return content_type, raw

        raise ValueError("too many image source redirects")

    @staticmethod
    def _parse_url(raw_url: str):
        if any(ord(character) < 32 or ord(character) == 127 for character in raw_url):
            raise ValueError("invalid source_url")

        try:
            parsed_url = urllib_parse.urlsplit(raw_url)
            hostname = parsed_url.hostname
            port = parsed_url.port
        except ValueError as error:
            raise ValueError("invalid source_url") from error

        if parsed_url.scheme not in ("http", "https"):
            raise ValueError("only http/https source_url is allowed")

        if not parsed_url.netloc or not hostname or "@" in parsed_url.netloc:
            raise ValueError("invalid source_url")

        if "%" in hostname:
            raise ValueError("invalid source_url")

        try:
            host = hostname.encode("idna").decode("ascii")
        except UnicodeError as error:
            raise ValueError("invalid source_url") from error

        port = port if port is not None else (443 if parsed_url.scheme == "https" else 80)

        if port < 1 or port > 65535:
            raise ValueError("invalid source_url")

        return parsed_url, host, port

    @staticmethod
    def _resolve_public_address(host: str, port: int) -> str:
        try:
            results = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        except OSError as error:
            raise ValueError("source host resolution failed") from error

        public_addresses = []

        for family, _, _, _, sockaddr in results:
            if family not in (socket.AF_INET, socket.AF_INET6):
                continue

            address_text = str(sockaddr[0])

            if "%" in address_text:
                raise ValueError("source host must resolve only to public IP addresses")

            try:
                address = ipaddress.ip_address(address_text)
            except ValueError as error:
                raise ValueError("source host resolved to an invalid address") from error

            if (
                isinstance(address, ipaddress.IPv6Address)
                and address in _WELL_KNOWN_NAT64_PREFIX
            ):
                embedded_ipv4 = ipaddress.IPv4Address(int(address) & 0xFFFFFFFF)

                if not embedded_ipv4.is_global:
                    raise ValueError("source host must resolve only to public IP addresses")

            if not address.is_global:
                raise ValueError("source host must resolve only to public IP addresses")

            public_addresses.append(address.compressed)

        if not public_addresses:
            raise ValueError("source host did not resolve to a public IP address")

        return public_addresses[0]

    @classmethod
    def _create_connection(cls, parsed_url, host: str, address: str, port: int):
        connection_type = (
            _PinnedHTTPSConnection
            if parsed_url.scheme == "https"
            else _PinnedHTTPConnection
        )
        return connection_type(host, address, port, cls.timeout_seconds)

    @staticmethod
    def _build_request_target(parsed_url) -> str:
        path = urllib_parse.quote(
            parsed_url.path or "/",
            safe="/%:@!$&'()*+,;=-._~",
        )
        query = urllib_parse.quote(
            parsed_url.query,
            safe="/?%:@!$&'()*+,;=-._~",
        )

        return f"{path}?{query}" if query else path
