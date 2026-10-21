from datetime import timedelta
from pathlib import Path

import httpx
import pytest

from ikea_scraper.http import Client, DisallowedUrlError

PAGE = "https://www.ikea.com/ca/en/p/testa-sofa-gray-s12345678/"


class FakeTime:
    def __init__(self) -> None:
        self.now = 0.0
        self.sleeps: list[float] = []

    def clock(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


def make_client(tmp_path: Path, handler, **kwargs) -> tuple[Client, FakeTime, list[str]]:
    seen: list[str] = []

    def record(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return handler(request)

    t = FakeTime()
    client = Client(
        tmp_path / "raw",
        transport=httpx.MockTransport(record),
        clock=t.clock,
        sleep=t.sleep,
        **kwargs,
    )
    return client, t, seen


@pytest.mark.parametrize(
    "url",
    [
        "https://www.ikea.com/global/assets/rotera/model.glb",
        "https://www.ikea.com/ca/en/meta-data/navigation/catalog-products-slim.json",
        "https://www.ikea.com/ca/en/search/?q=sofa",
        "https://www.ikea.com/ca/en/cat/sofas-fu003/?filters=f-colors:10028",
        "https://web-api.ikea.com/ca/en/rotera/data/exists/12345678/",
    ],
)
def test_refuses_urls_outside_the_allowlist(tmp_path: Path, url: str) -> None:
    client, _, seen = make_client(tmp_path, lambda r: httpx.Response(200))
    with pytest.raises(DisallowedUrlError):
        client.get_text(url)
    assert seen == []


def test_caches_responses(tmp_path: Path) -> None:
    client, _, seen = make_client(tmp_path, lambda r: httpx.Response(200, text="hello"))
    first = client.get_text(PAGE)
    second = client.get_text(PAGE)
    assert (first.text, first.from_cache) == ("hello", False)
    assert (second.text, second.from_cache) == ("hello", True)
    assert second.fetched_at == first.fetched_at
    assert len(seen) == 1


def test_refetches_stale_cache_entries(tmp_path: Path) -> None:
    client, _, seen = make_client(
        tmp_path, lambda r: httpx.Response(200, text="x"), max_age=timedelta(0)
    )
    client.get_text(PAGE)
    client.get_text(PAGE)
    assert len(seen) == 2


def test_waits_between_requests(tmp_path: Path) -> None:
    client, t, _ = make_client(tmp_path, lambda r: httpx.Response(200, text="x"))
    client.get_text(PAGE)
    client.get_text("https://www.ikea.com/ca/en/p/testa-chair-87654321/")
    assert t.sleeps == [pytest.approx(1.0)]


def test_rejects_delays_under_one_second(tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        Client(tmp_path, min_interval=0.5)


def test_retries_server_errors(tmp_path: Path) -> None:
    statuses = iter([503, 200])
    client, t, seen = make_client(tmp_path, lambda r: httpx.Response(next(statuses), text="ok"))
    resp = client.get_text(PAGE)
    assert resp.status == 200
    assert len(seen) == 2
    assert 2.0 in t.sleeps


def test_does_not_follow_redirects_off_the_allowlist(tmp_path: Path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(301, headers={"location": "/ca/en/cat/sofas-fu003/"})

    client, _, seen = make_client(tmp_path, handler)
    resp = client.get_text(PAGE)
    assert resp.status == 301
    assert seen == [PAGE]


def test_follows_redirects_within_the_allowlist(tmp_path: Path) -> None:
    moved = "https://www.ikea.com/ca/en/p/testa-sofa-grey-s12345678/"

    def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url) == PAGE:
            return httpx.Response(301, headers={"location": moved})
        return httpx.Response(200, text="moved here")

    client, _, seen = make_client(tmp_path, handler)
    assert client.get_text(PAGE).text == "moved here"
    assert seen == [PAGE, moved]


def test_download_writes_file_once(tmp_path: Path) -> None:
    url = "https://web-api.ikea.com/dimma/assets/test/model.glb"
    client, _, seen = make_client(tmp_path, lambda r: httpx.Response(200, content=b"glTF"))
    dest = tmp_path / "models" / "12345678.glb"
    assert client.download(url, dest) is True
    assert client.download(url, dest) is False
    assert dest.read_bytes() == b"glTF"
    assert len(seen) == 1


def test_keep_trims_before_caching(tmp_path: Path) -> None:
    client, _, _ = make_client(tmp_path, lambda r: httpx.Response(200, text="abcdef"))
    assert client.get_text(PAGE, keep=lambda t: t[:3]).text == "abc"
    assert client.get_text(PAGE).text == "abc"
