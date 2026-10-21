"""A polite HTTP client: a URL allowlist, a rate limit, retries and a gzip disk cache."""

from __future__ import annotations

import gzip
import hashlib
import json
import logging
import re
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import urljoin

import httpx

log = logging.getLogger(__name__)

USER_AGENT = "roomie-catalog/0.1 (+https://github.com/ivan-lyf/roomie)"
MIN_INTERVAL_S = 1.0

# Every URL the scraper may fetch, checked by hand against each host's robots.txt
# on 2026-10-21. www.ikea.com disallows */global/assets/rotera/*, */navigation/ and
# filter/sort URLs, and web-api.ikea.com only allows /dimma/assets/. Re-check
# robots.txt before adding anything here.
ALLOWED_URLS = (
    re.compile(r"^https://www\.ikea\.com/sitemaps/[\w.-]+\.xml$"),
    re.compile(r"^https://www\.ikea\.com/ca/en/p/[\w-]+/$"),
    re.compile(r"^https://sik\.search\.blue\.cdtapps\.com/ca/en/product-list-page/more-products\?"),
    re.compile(r"^https://web-api\.ikea\.com/dimma/assets/"),
)

RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})
CACHEABLE_STATUSES = frozenset({200, 301, 302, 303, 307, 308, 404, 410})
MAX_REDIRECTS = 5


class DisallowedUrlError(ValueError):
    """The URL isn't on the allowlist."""


def is_allowed(url: str) -> bool:
    return any(p.match(url) for p in ALLOWED_URLS)


def check_allowed(url: str) -> None:
    if not is_allowed(url):
        raise DisallowedUrlError(url)


@dataclass(frozen=True)
class Response:
    url: str
    status: int
    fetched_at: datetime
    text: str
    from_cache: bool


class Client:
    def __init__(
        self,
        cache_dir: Path,
        *,
        min_interval: float = MIN_INTERVAL_S,
        max_age: timedelta | None = timedelta(days=7),
        max_retries: int = 3,
        transport: httpx.BaseTransport | None = None,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        if min_interval < MIN_INTERVAL_S:
            raise ValueError(f"min_interval must be at least {MIN_INTERVAL_S}s")
        self.cache_dir = cache_dir
        self.min_interval = min_interval
        self.max_age = max_age
        self.max_retries = max_retries
        self.network_requests = 0
        self._clock = clock
        self._sleep = sleep
        self._last_request: float | None = None
        self._http = httpx.Client(
            headers={"User-Agent": USER_AGENT},
            timeout=30,
            follow_redirects=False,
            transport=transport,
        )

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> Client:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def get_text(self, url: str, keep: Callable[[str], str] | None = None) -> Response:
        """GET a page, from the cache when it's fresh enough.

        `keep` trims a fresh body before it's cached and returned.
        """
        check_allowed(url)
        path = self._cache_path(url)
        cached = self._read_cache(path)
        if cached and not self._is_stale(cached):
            return cached
        resp = self._get(url)
        result = Response(
            url=url,
            status=resp.status_code,
            fetched_at=datetime.now(UTC),
            text=keep(resp.text) if keep else resp.text,
            from_cache=False,
        )
        if result.status in CACHEABLE_STATUSES:
            self._write_cache(path, result)
        return result

    def download(self, url: str, dest: Path) -> bool:
        """Download a binary file unless dest already exists. Returns True if it downloaded."""
        check_allowed(url)
        if dest.exists():
            return False
        resp = self._get(url)
        resp.raise_for_status()
        dest.parent.mkdir(parents=True, exist_ok=True)
        part = dest.with_name(dest.name + ".part")
        part.write_bytes(resp.content)
        part.replace(dest)
        return True

    def _get(self, url: str) -> httpx.Response:
        """GET with retries. Follows redirects only to allowlisted URLs."""
        for _ in range(MAX_REDIRECTS + 1):
            resp = self._get_with_retries(url)
            location = resp.headers.get("location")
            if not resp.is_redirect or not location:
                return resp
            target = urljoin(url, location)
            if not is_allowed(target):
                log.debug("not following redirect %s -> %s", url, target)
                return resp
            url = target
        return resp

    def _get_with_retries(self, url: str) -> httpx.Response:
        for attempt in range(self.max_retries + 1):
            self._wait_turn()
            try:
                resp = self._http.get(url)
            except httpx.TransportError as e:
                if attempt == self.max_retries:
                    raise
                log.warning("%s: %s, retrying", url, e)
                self._backoff(attempt, None)
                continue
            if resp.status_code in RETRY_STATUSES and attempt < self.max_retries:
                log.warning("%s: HTTP %d, retrying", url, resp.status_code)
                self._backoff(attempt, resp.headers.get("retry-after"))
                continue
            return resp
        raise AssertionError("unreachable")

    def _wait_turn(self) -> None:
        now = self._clock()
        if self._last_request is not None:
            wait = self.min_interval - (now - self._last_request)
            if wait > 0:
                self._sleep(wait)
                now += wait
        self._last_request = now
        self.network_requests += 1

    def _backoff(self, attempt: int, retry_after: str | None) -> None:
        delay = float(2 ** (attempt + 1))
        if retry_after and retry_after.isdigit():
            delay = max(delay, float(retry_after))
        self._sleep(min(delay, 120.0))

    def _cache_path(self, url: str) -> Path:
        digest = hashlib.sha256(url.encode()).hexdigest()
        return self.cache_dir / digest[:2] / f"{digest}.json.gz"

    def _is_stale(self, cached: Response) -> bool:
        if self.max_age is None:
            return False
        return datetime.now(UTC) - cached.fetched_at > self.max_age

    def _read_cache(self, path: Path) -> Response | None:
        try:
            with gzip.open(path, "rt", encoding="utf-8") as f:
                entry = json.load(f)
        except FileNotFoundError:
            return None
        except (OSError, ValueError):
            log.warning("ignoring unreadable cache entry %s", path)
            return None
        return Response(
            url=entry["url"],
            status=entry["status"],
            fetched_at=datetime.fromisoformat(entry["fetchedAt"]),
            text=entry["text"],
            from_cache=True,
        )

    def _write_cache(self, path: Path, resp: Response) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        part = path.with_name(path.name + ".part")
        with gzip.open(part, "wt", encoding="utf-8") as f:
            json.dump(
                {
                    "url": resp.url,
                    "status": resp.status,
                    "fetchedAt": resp.fetched_at.isoformat(),
                    "text": resp.text,
                },
                f,
                ensure_ascii=False,
            )
        part.replace(path)
