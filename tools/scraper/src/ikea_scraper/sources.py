"""Where product URLs come from: the sitemap (every product) or category listings."""

from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
from collections.abc import Iterable

from ikea_scraper.http import Client

SITEMAP_INDEX_URL = "https://www.ikea.com/sitemaps/sitemap.xml"
PRODUCT_SITEMAP = re.compile(r"/sitemaps/prod-en-CA_\d+\.xml$")
LISTING_URL = (
    "https://sik.search.blue.cdtapps.com/ca/en/product-list-page/more-products"
    "?category={category}&start={start}&end={end}"
)
LISTING_PAGE_SIZE = 1000
CATEGORY_ID = re.compile(r"^[a-z]{0,3}\d+$")
PRODUCT_URL = re.compile(r"^https://www\.ikea\.com/ca/en/p/[\w-]+-(s?\d{8})/$")
_SITEMAP_LOC = "{http://www.sitemaps.org/schemas/sitemap/0.9}loc"


class SourceError(RuntimeError):
    pass


def item_no_from_url(url: str) -> str | None:
    """'.../uppland-sofa-kilanda-light-beige-s59442483/' -> '59442483'."""
    m = PRODUCT_URL.match(url)
    return m[1].removeprefix("s") if m else None


def sitemap_product_urls(client: Client) -> list[str]:
    """Every en-CA product page listed in IKEA's sitemap."""
    urls: list[str] = []
    for sitemap in _locs(_get(client, SITEMAP_INDEX_URL)):
        if PRODUCT_SITEMAP.search(sitemap):
            urls.extend(_locs(_get(client, sitemap)))
    return _product_urls(urls)


def category_product_urls(client: Client, category: str) -> list[str]:
    """Every product page in one IKEA category (e.g. 'fu003'), including variants."""
    if not CATEGORY_ID.match(category):
        raise SourceError(f"not an IKEA category id: {category!r}")
    urls: list[str] = []
    start = 0
    while True:
        url = LISTING_URL.format(category=category, start=start, end=start + LISTING_PAGE_SIZE)
        window = json.loads(_get(client, url)).get("moreProducts", {}).get("productWindow", [])
        for product in window:
            urls.append(product.get("pipUrl", ""))
            for variant in (product.get("gprDescription") or {}).get("variants", []):
                urls.append(variant.get("pipUrl", ""))
        if len(window) < LISTING_PAGE_SIZE:
            break
        start += LISTING_PAGE_SIZE
    return _product_urls(urls)


def _get(client: Client, url: str) -> str:
    resp = client.get_text(url)
    if resp.status != 200:
        raise SourceError(f"{url}: HTTP {resp.status}")
    return resp.text


def _locs(xml_text: str) -> list[str]:
    root = ET.fromstring(xml_text.encode("utf-8"))
    return [el.text.strip() for el in root.iter(_SITEMAP_LOC) if el.text]


def _product_urls(urls: Iterable[str]) -> list[str]:
    """Keep product page URLs only, one per item number, in first-seen order."""
    seen: set[str] = set()
    out: list[str] = []
    for url in urls:
        item_no = item_no_from_url(url)
        if item_no and item_no not in seen:
            seen.add(item_no)
            out.append(url)
    return out
