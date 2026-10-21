"""Extract product data from an IKEA.ca product page.

Reads the page's embedded JSON (schema.org JSON-LD and the page's hydration
data), never the rendered HTML.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any

from ikea_scraper.measure import parse_length
from ikea_scraper.sources import item_no_from_url

_SCRIPT = re.compile(r"<script\b([^>]*)>(.*?)</script>", re.S | re.I)
_CATEGORY_ID = re.compile(r"/cat/[^/]*-([a-z]{0,3}\d+)/?$")
_PROPS_MARKER = '"productInformationSectionProps"'


def parse_product_page(html: str, url: str, scraped_at: datetime) -> dict[str, Any] | None:
    """Return one item record, or None if the page has no product data."""
    json_ld = _json_ld(html)
    product_ld = _first_of_type(json_ld, "Product")
    if product_ld is None:
        return None
    props = _page_props(html) or {}
    product = props.get("product") or {}
    offer = _offer(product_ld.get("offers"))

    url_item_no = item_no_from_url(url)
    return {
        "itemNo": product.get("itemNo") or url_item_no,
        "articleNo": product.get("visibleItemNo") or product_ld.get("mpn"),
        "itemType": product.get("type") or ("SPR" if f"-s{url_item_no}/" in url else "ART"),
        "url": url,
        "name": product_ld.get("name"),
        "productName": product.get("name"),
        "description": product.get("description"),
        "priceCad": _price(product, offer),
        "currency": product.get("currencyCode") or offer.get("priceCurrency"),
        "availability": _availability(offer),
        "categoryPath": _category_path(_first_of_type(json_ld, "BreadcrumbList")),
        "measurements": _measurements(props),
        "color": product_ld.get("color"),
        "material": product_ld.get("material"),
        "imageUrl": _first_image(product_ld.get("image")),
        "modelUrl": _model_url(_first_of_type(json_ld, "3DModel")),
        "scrapedAt": scraped_at.isoformat(),
    }


def keep_product_data(html: str) -> str:
    """The parts of a product page the parser reads, verbatim.

    That's the JSON-LD and the product's hydration block, about 3% of the page.
    Caching only these keeps a full crawl to a few hundred MB.
    """
    return "".join(
        m[0]
        for m in _SCRIPT.finditer(html)
        if _has_type(m[1], "application/ld+json")
        or (_has_type(m[1], "text/hydrate") and _PROPS_MARKER in m[2])
    )


def _has_type(attrs: str, script_type: str) -> bool:
    return re.search(rf'type\s*=\s*"{re.escape(script_type)}"', attrs, re.I) is not None


def _scripts(html: str, script_type: str) -> list[str]:
    return [body for attrs, body in _SCRIPT.findall(html) if _has_type(attrs, script_type)]


def _json_ld(html: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for body in _scripts(html, "application/ld+json"):
        try:
            data = json.loads(body)
        except ValueError:
            continue
        for node in data if isinstance(data, list) else [data]:
            if isinstance(node, dict):
                out.extend(node.get("@graph", [node]))
    return out


def _first_of_type(nodes: list[dict[str, Any]], type_name: str) -> dict[str, Any] | None:
    for node in nodes:
        t = node.get("@type")
        if t == type_name or (isinstance(t, list) and type_name in t):
            return node
    return None


def _page_props(html: str) -> dict[str, Any] | None:
    """The hydration data that holds the product and its measurements."""
    for body in _scripts(html, "text/hydrate"):
        if _PROPS_MARKER not in body:
            continue
        try:
            found = _find_props(json.loads(body), depth=0)
        except ValueError:
            continue
        if found is not None:
            return found
    return None


def _find_props(node: Any, depth: int) -> dict[str, Any] | None:
    if depth > 8:
        return None
    if isinstance(node, dict):
        if "product" in node and "productInformationSectionProps" in node:
            return node
        children = node.values()
    elif isinstance(node, list):
        children = node
    else:
        return None
    for child in children:
        found = _find_props(child, depth + 1)
        if found is not None:
            return found
    return None


def _offer(offers: Any) -> dict[str, Any]:
    if isinstance(offers, list):
        offers = offers[0] if offers else {}
    return offers if isinstance(offers, dict) else {}


def _price(product: dict[str, Any], offer: dict[str, Any]) -> float | None:
    for value in (product.get("price"), offer.get("price"), offer.get("lowPrice")):
        try:
            return float(value)
        except (TypeError, ValueError):
            continue
    return None


def _availability(offer: dict[str, Any]) -> str | None:
    value = offer.get("availability")
    return value.rstrip("/").rsplit("/", 1)[-1] if isinstance(value, str) else None


def _category_path(breadcrumbs: dict[str, Any] | None) -> list[dict[str, str]]:
    if breadcrumbs is None:
        return []
    items = sorted(breadcrumbs.get("itemListElement", []), key=lambda i: i.get("position", 0))
    path: list[dict[str, str]] = []
    for item in items:
        target = item.get("item")
        href = target.get("@id") if isinstance(target, dict) else target
        m = _CATEGORY_ID.search(href) if isinstance(href, str) else None
        if m:
            path.append({"id": m[1], "name": item.get("name", "")})
    return path


def _measurements(props: dict[str, Any]) -> list[dict[str, Any]]:
    info = props.get("productInformationSectionProps") or {}
    raw = (info.get("measurementsProps") or {}).get("measurements") or []
    out: list[dict[str, Any]] = []
    for m in raw:
        text = m.get("measure") or ""
        length = parse_length(text)
        out.append(
            {
                "name": m.get("name"),
                "type": m.get("type"),
                "text": text,
                "minM": length.min_m if length else None,
                "maxM": length.max_m if length else None,
            }
        )
    return out


def _first_image(image: Any) -> str | None:
    first = image[0] if isinstance(image, list) and image else image
    if isinstance(first, dict):
        first = first.get("contentUrl") or first.get("url")
    return first if isinstance(first, str) else None


def _model_url(model: dict[str, Any] | None) -> str | None:
    if model is None:
        return None
    encodings = model.get("encoding") or []
    for enc in encodings if isinstance(encodings, list) else [encodings]:
        if isinstance(enc, dict) and enc.get("encodingFormat") == "model/gltf-binary":
            return enc.get("contentUrl")
    return None
