import json
from pathlib import Path

import httpx
from pages import LISTING, MODEL_URL, PRODUCT_URL, product_page

from ikea_scraper import cli
from ikea_scraper.http import Client


def test_crawl_writes_items_report_and_models(tmp_path: Path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url.startswith("https://sik.search.blue.cdtapps.com/"):
            return httpx.Response(200, text=json.dumps(LISTING))
        if url == PRODUCT_URL:
            return httpx.Response(200, text=product_page())
        if url == MODEL_URL:
            return httpx.Response(200, content=b"glTF")
        return httpx.Response(404)

    args = cli._parse_args(["--", "--category", "fu003", "--models"])
    client = Client(tmp_path / "raw", transport=httpx.MockTransport(handler), sleep=lambda s: 0)
    assert cli._crawl(client, args, tmp_path) == 0

    items = [json.loads(line) for line in (tmp_path / "items.jsonl").read_text().splitlines()]
    assert [i["itemNo"] for i in items] == ["12345678"]
    assert (tmp_path / "models" / "12345678.glb").read_bytes() == b"glTF"
    report = json.loads((tmp_path / "report.json").read_text())
    assert report["scraped"] == 1
    assert report["modelsDownloaded"] == 1
    assert sorted(f["error"] for f in report["failures"]) == ["HTTP 404", "HTTP 404"]


def test_crawl_merges_into_existing_items(tmp_path: Path) -> None:
    (tmp_path / "items.jsonl").write_text(json.dumps({"itemNo": "99999999", "name": "old"}) + "\n")

    def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url).startswith("https://sik.search.blue.cdtapps.com/"):
            return httpx.Response(200, text=json.dumps(LISTING))
        if str(request.url) == PRODUCT_URL:
            return httpx.Response(200, text=product_page())
        return httpx.Response(404)

    args = cli._parse_args(["--category", "fu003", "--limit", "1"])
    client = Client(tmp_path / "raw", transport=httpx.MockTransport(handler), sleep=lambda s: 0)
    cli._crawl(client, args, tmp_path)

    lines = (tmp_path / "items.jsonl").read_text().splitlines()
    assert [json.loads(line)["itemNo"] for line in lines] == ["12345678", "99999999"]
