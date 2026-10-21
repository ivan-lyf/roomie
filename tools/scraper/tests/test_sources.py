import json
from pathlib import Path

import httpx
import pytest
from pages import LISTING, PRODUCT_SITEMAP, SITEMAP_INDEX

from ikea_scraper.http import Client
from ikea_scraper.sources import (
    SourceError,
    category_product_urls,
    item_no_from_url,
    sitemap_product_urls,
)


def make_client(tmp_path: Path, routes: dict[str, str]) -> tuple[Client, list[str]]:
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        seen.append(url)
        for prefix, body in routes.items():
            if url.startswith(prefix):
                return httpx.Response(200, text=body)
        return httpx.Response(404)

    client = Client(tmp_path, transport=httpx.MockTransport(handler), sleep=lambda s: None)
    return client, seen


def test_item_no_from_url() -> None:
    assert item_no_from_url("https://www.ikea.com/ca/en/p/testa-sofa-s12345678/") == "12345678"
    assert item_no_from_url("https://www.ikea.com/ca/en/p/testa-chair-87654321/") == "87654321"
    assert item_no_from_url("https://www.ikea.com/ca/en/cat/sofas-fu003/") is None


def test_sitemap_reads_only_english_canada_product_sitemaps(tmp_path: Path) -> None:
    client, seen = make_client(
        tmp_path,
        {
            "https://www.ikea.com/sitemaps/sitemap.xml": SITEMAP_INDEX,
            "https://www.ikea.com/sitemaps/prod-en-CA_1.xml": PRODUCT_SITEMAP,
        },
    )
    urls = sitemap_product_urls(client)
    assert urls == [
        "https://www.ikea.com/ca/en/p/testa-sofa-gray-s12345678/",
        "https://www.ikea.com/ca/en/p/testa-chair-white-87654321/",
    ]
    assert seen == [
        "https://www.ikea.com/sitemaps/sitemap.xml",
        "https://www.ikea.com/sitemaps/prod-en-CA_1.xml",
    ]


def test_category_listing_includes_variants_once(tmp_path: Path) -> None:
    client, seen = make_client(
        tmp_path, {"https://sik.search.blue.cdtapps.com/": json.dumps(LISTING)}
    )
    urls = category_product_urls(client, "fu003")
    assert urls == [
        "https://www.ikea.com/ca/en/p/testa-sofa-gray-s12345678/",
        "https://www.ikea.com/ca/en/p/testa-sofa-blue-s22345678/",
        "https://www.ikea.com/ca/en/p/testa-loveseat-32345678/",
    ]
    assert seen == [
        "https://sik.search.blue.cdtapps.com/ca/en/product-list-page/more-products"
        "?category=fu003&start=0&end=1000"
    ]


def test_category_ids_are_validated(tmp_path: Path) -> None:
    client, seen = make_client(tmp_path, {})
    with pytest.raises(SourceError):
        category_product_urls(client, "fu003&start=0")
    assert seen == []
