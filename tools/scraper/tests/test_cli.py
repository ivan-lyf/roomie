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


def test_models_for_downloads_only_catalog_models(tmp_path: Path) -> None:
    other_model = MODEL_URL.replace("12345678", "22345678")
    items = [
        {"itemNo": "12345678", "modelUrl": MODEL_URL},
        {"itemNo": "22345678", "modelUrl": other_model},  # not in the catalog
        {"itemNo": "32345678", "modelUrl": None},
    ]
    (tmp_path / "items.jsonl").write_text("".join(json.dumps(i) + "\n" for i in items))
    catalog = tmp_path / "products.json"
    catalog.write_text(json.dumps([{"articleNo": "123.456.78"}, {"articleNo": "323.456.78"}]))
    requested: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested.append(str(request.url))
        return httpx.Response(200, content=b"glTF")

    args = cli._parse_args(["--models-for", str(catalog)])
    client = Client(tmp_path / "raw", transport=httpx.MockTransport(handler), sleep=lambda s: 0)
    assert cli._download_catalog_models(client, args.models_for, tmp_path) == 0
    assert requested == [MODEL_URL]
    assert (tmp_path / "models" / "12345678.glb").read_bytes() == b"glTF"
    assert json.loads((tmp_path / "report.json").read_text())["modelsDownloaded"] == 1

    # A second run finds the model on disk and fetches nothing.
    assert cli._download_catalog_models(client, args.models_for, tmp_path) == 0
    assert requested == [MODEL_URL]
