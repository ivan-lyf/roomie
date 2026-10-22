# ikea-scraper

Fetches IKEA.ca product data from public pages. No API keys, accounts or cookies.

## Usage

From the repo root:

```bash
pnpm scrape                              # every product in the sitemap (~25k pages, ~7 h)
pnpm scrape --category fu003 --models    # one category (fu003 = sofas), plus 3D models
pnpm scrape --category fu003 --limit 20  # a quick sample
```

or `uv run --project tools/scraper ikea-scrape --help`. A category id is the last part of a
category page URL: `ikea.com/ca/en/cat/sofas-fu003/` → `fu003`. `--category` can be repeated.

Responses are cached for 7 days (`--max-age-days`, or `--refresh` to ignore the cache), so
re-running an interrupted crawl picks up where it stopped.

## Where the data comes from

| What | Source |
|---|---|
| Every product URL | `prod-en-CA_*.xml` in IKEA's sitemap |
| Products in one category | The listing API the category pages use (`sik.search.blue.cdtapps.com`) |
| Product details | The product page's JSON-LD and hydration JSON (not the rendered HTML) |
| 3D models | The GLB linked from the page's `3DModel` JSON-LD (`web-api.ikea.com/dimma/assets/`) |

Only URLs matching `ALLOWED_URLS` in `src/ikea_scraper/http.py` are fetched, and each pattern
was checked against that host's `robots.txt`. Requests are at least 1 s apart, carry an honest
User-Agent, and back off on 429 and 5xx responses.

## Output

Everything goes to `data/ikea/` at the repo root, which is gitignored:

- `items.jsonl`: one item per line. Runs merge into it by `itemNo`. Each item also lists the
  options it was picked by (color, size, ...) and the item numbers of its other variants.
- `models/<itemNo>.glb`: 3D models, with `--models`.
- `raw/`: cached responses. Product pages are trimmed to the embedded JSON the parser reads.
- `report.json`: a summary of the last run, including failures.

```json
{
  "itemNo": "59442483",
  "articleNo": "594.424.83",
  "itemType": "SPR",
  "url": "https://www.ikea.com/ca/en/p/uppland-sofa-kilanda-light-beige-s59442483/",
  "name": "UPPLAND Sofa - Kilanda light beige",
  "productName": "UPPLAND",
  "description": "Sofa, Kilanda light beige",
  "priceCad": 749.0,
  "currency": "CAD",
  "availability": "InStock",
  "categoryPath": [{"id": "700640", "name": "Sofas & armchairs"}, {"id": "fu003", "name": "Sofas"}],
  "measurements": [{"name": "Width", "type": "00047", "text": "224 cm (88 1/4 \")", "minM": 2.24, "maxM": 2.24}],
  "color": "beige",
  "material": "Fabric",
  "imageUrl": "https://www.ikea.com/ca/en/images/products/...",
  "modelUrl": "https://web-api.ikea.com/dimma/assets/.../simple.glb?cn=pip",
  "scrapedAt": "2026-10-21T15:55:24+00:00"
}
```

Lengths are in meters. A range such as "41-55 cm" sets both `minM` and `maxM`, and `text`
keeps IKEA's original wording. Items with `itemType` `SPR` are combinations of several articles.

The data and models are for personal and portfolio use only. Don't redistribute them.

## Development

```bash
cd tools/scraper
uv run pytest
uv run ruff check && uv run ruff format --check
```
