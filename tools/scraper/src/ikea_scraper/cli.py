"""ikea-scrape: fetch IKEA.ca products into data/ikea/items.jsonl."""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx

from ikea_scraper.http import MIN_INTERVAL_S, Client
from ikea_scraper.parse import keep_product_data, parse_product_page
from ikea_scraper.sources import SourceError, category_product_urls, sitemap_product_urls

log = logging.getLogger("ikea_scraper")


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(sys.argv[1:] if argv is None else argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )
    logging.getLogger("httpx").setLevel(logging.DEBUG if args.verbose else logging.WARNING)
    if args.delay < MIN_INTERVAL_S:
        log.error("--delay must be at least %ss", MIN_INTERVAL_S)
        return 2
    data_dir: Path = args.data_dir or _default_data_dir()
    max_age = timedelta(0) if args.refresh else timedelta(days=args.max_age_days)
    with Client(data_dir / "raw", min_interval=args.delay, max_age=max_age) as client:
        try:
            if args.models_for:
                return _download_catalog_models(client, args.models_for, data_dir)
            return _crawl(client, args, data_dir)
        except SourceError as e:
            log.error("%s", e)
            return 1


def _parse_args(argv: list[str]) -> argparse.Namespace:
    if argv[:1] == ["--"]:  # `pnpm scrape -- --category fu003` passes the separator through
        argv = argv[1:]
    p = argparse.ArgumentParser(
        prog="ikea-scrape",
        description="Fetch IKEA.ca product data from public pages. No credentials needed.",
    )
    p.add_argument(
        "--category",
        action="append",
        default=[],
        metavar="ID",
        help="IKEA category id, e.g. fu003 (sofas). Repeatable. Default: every product.",
    )
    p.add_argument("--limit", type=int, help="stop after this many product pages")
    p.add_argument("--models", action="store_true", help="also download 3D models (GLB)")
    p.add_argument(
        "--models-for",
        type=Path,
        metavar="CATALOG",
        help="only download the 3D models of the products in this catalog file "
        "(data/catalog/products.json), from the model URLs already scraped",
    )
    p.add_argument(
        "--max-age-days",
        type=float,
        default=7.0,
        help="refetch cached responses older than this (default: 7)",
    )
    p.add_argument("--refresh", action="store_true", help="ignore the cache")
    p.add_argument(
        "--delay",
        type=float,
        default=MIN_INTERVAL_S,
        help=f"seconds between requests (minimum {MIN_INTERVAL_S})",
    )
    p.add_argument("--data-dir", type=Path, help="output directory (default: <repo>/data/ikea)")
    p.add_argument("-v", "--verbose", action="store_true")
    return p.parse_args(argv)


def _default_data_dir() -> Path:
    here = Path.cwd().resolve()
    for d in (here, *here.parents):
        if (d / "pnpm-workspace.yaml").exists():
            return d / "data" / "ikea"
    return here / "data" / "ikea"


def _crawl(client: Client, args: argparse.Namespace, data_dir: Path) -> int:
    started_at = datetime.now(UTC)
    if args.category:
        urls: list[str] = []
        for category in args.category:
            found = category_product_urls(client, category)
            log.info("category %s: %d products", category, len(found))
            urls.extend(u for u in found if u not in urls)
    else:
        urls = sitemap_product_urls(client)
        log.info("sitemap: %d products", len(urls))
    if args.limit is not None:
        urls = urls[: args.limit]

    items_path = data_dir / "items.jsonl"
    items = _read_items(items_path)
    failures: list[dict[str, str]] = []
    scraped = 0
    models = 0
    t0 = time.monotonic()
    try:
        for i, url in enumerate(urls, 1):
            record = _scrape_one(client, url, failures)
            if record is not None:
                items[record["itemNo"]] = record
                scraped += 1
                if args.models and record["modelUrl"]:
                    models += _download_model(client, record, data_dir, failures)
            if i % 50 == 0 or i == len(urls):
                _progress(i, len(urls), scraped, len(failures), t0)
    except KeyboardInterrupt:
        log.warning("interrupted; saving what was scraped so far (re-run to resume)")
    finally:
        _write_items(items_path, items)
        _write_report(
            data_dir / "report.json",
            {
                "startedAt": started_at.isoformat(),
                "finishedAt": datetime.now(UTC).isoformat(),
                "categories": args.category,
                "products": len(urls),
                "scraped": scraped,
                "modelsDownloaded": models,
                "networkRequests": client.network_requests,
                "failures": failures,
            },
        )
    log.info(
        "done: %d scraped, %d failed, %d models downloaded, %d items in %s",
        scraped,
        len(failures),
        models,
        len(items),
        items_path,
    )
    return 0 if scraped or not urls else 1


def _download_catalog_models(client: Client, catalog: Path, data_dir: Path) -> int:
    """Download the models of every catalog product, skipping models already on disk."""
    started_at = datetime.now(UTC)
    products = json.loads(catalog.read_text(encoding="utf-8"))
    wanted = sorted({p["articleNo"].replace(".", "") for p in products})
    items = _read_items(data_dir / "items.jsonl")
    records = [items[i] for i in wanted if i in items and items[i].get("modelUrl")]
    log.info("%d catalog products, %d with a model", len(wanted), len(records))

    failures: list[dict[str, str]] = []
    downloaded = 0
    t0 = time.monotonic()
    try:
        for i, record in enumerate(records, 1):
            downloaded += _download_model(client, record, data_dir, failures)
            if i % 50 == 0 or i == len(records):
                _progress(i, len(records), downloaded, len(failures), t0, "downloaded")
    except KeyboardInterrupt:
        log.warning("interrupted; re-run to resume")
    finally:
        _write_report(
            data_dir / "report.json",
            {
                "startedAt": started_at.isoformat(),
                "finishedAt": datetime.now(UTC).isoformat(),
                "catalog": str(catalog),
                "products": len(wanted),
                "withModels": len(records),
                "modelsDownloaded": downloaded,
                "networkRequests": client.network_requests,
                "failures": failures,
            },
        )
    log.info(
        "done: %d models downloaded, %d already on disk, %d failed",
        downloaded,
        len(records) - downloaded - len(failures),
        len(failures),
    )
    return 1 if records and len(failures) == len(records) else 0


def _scrape_one(client: Client, url: str, failures: list[dict[str, str]]) -> dict[str, Any] | None:
    try:
        resp = client.get_text(url, keep=keep_product_data)
    except httpx.HTTPError as e:
        failures.append({"url": url, "error": str(e)})
        return None
    if resp.status != 200:
        failures.append({"url": url, "error": f"HTTP {resp.status}"})
        return None
    record = parse_product_page(resp.text, url, resp.fetched_at)
    if record is None or not record["itemNo"]:
        failures.append({"url": url, "error": "no product data on page"})
        return None
    log.debug("%s %s", record["itemNo"], record["name"])
    return record


def _download_model(
    client: Client, record: dict[str, Any], data_dir: Path, failures: list[dict[str, str]]
) -> int:
    dest = data_dir / "models" / f"{record['itemNo']}.glb"
    try:
        return int(client.download(record["modelUrl"], dest))
    except (httpx.HTTPError, ValueError) as e:
        failures.append({"url": record["modelUrl"], "error": str(e)})
        return 0


def _progress(
    done: int, total: int, ok: int, failed: int, t0: float, what: str = "scraped"
) -> None:
    elapsed = time.monotonic() - t0
    eta = elapsed / done * (total - done)
    log.info(
        "[%d/%d] %d %s, %d failed, ETA %s",
        done,
        total,
        ok,
        what,
        failed,
        timedelta(seconds=round(eta)),
    )


def _read_items(path: Path) -> dict[str, dict[str, Any]]:
    """Existing items, so a partial crawl updates the file instead of replacing it."""
    if not path.exists():
        return {}
    items: dict[str, dict[str, Any]] = {}
    with path.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                record = json.loads(line)
                items[record["itemNo"]] = record
    return items


def _write_items(path: Path, items: dict[str, dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    part = path.with_name(path.name + ".part")
    with part.open("w", encoding="utf-8") as f:
        for item_no in sorted(items):
            f.write(json.dumps(items[item_no], ensure_ascii=False) + "\n")
    part.replace(path)


def _write_report(path: Path, report: dict[str, Any]) -> None:
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
