"""Synthetic IKEA.ca responses shaped like the real ones (no real catalog content)."""

from __future__ import annotations

import json
from typing import Any

PRODUCT_URL = "https://www.ikea.com/ca/en/p/testa-sofa-gray-s12345678/"
MODEL_URL = "https://web-api.ikea.com/dimma/assets/test/12345678/simple/glb/testa.glb?cn=pip"


def product_page(
    *, with_model: bool = True, with_hydration: bool = True, with_decoy: bool = False
) -> str:
    breadcrumbs = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 2, "name": "Sofas & armchairs",
             "item": "https://www.ikea.com/ca/en/cat/sofas-armchairs-700640/"},
            {"@type": "ListItem", "position": 1, "name": "Products",
             "item": "https://www.ikea.com/ca/en/cat/products-products/"},
            {"@type": "ListItem", "position": 3, "name": "Sofas",
             "item": "https://www.ikea.com/ca/en/cat/sofas-fu003/"},
        ],
    }  # fmt: skip
    product = {
        "@context": "https://schema.org/",
        "@type": "Product",
        "name": "TESTA Sofa - Gray",
        "mpn": "123.456.78",
        "color": "gray",
        "material": "Fabric",
        "image": [{"@type": "ImageObject", "contentUrl": "https://www.ikea.com/ca/en/images/products/testa.jpg"}],
        "offers": {
            "@type": "Offer",
            "price": "799",
            "priceCurrency": "CAD",
            "availability": "https://schema.org/InStock",
        },
    }  # fmt: skip
    model = {
        "@context": "http://schema.org/",
        "@type": "3DModel",
        "encoding": [{"@type": "MediaObject", "contentUrl": MODEL_URL,
                      "encodingFormat": "model/gltf-binary"}],
    }  # fmt: skip
    hydration = {
        "0": {
            "loaderData": {
                "pageProps": {
                    "product": {
                        "itemNo": "12345678",
                        "visibleItemNo": "123.456.78",
                        "name": "TESTA",
                        "description": "Sofa, Gray",
                        "price": 799,
                        "currencyCode": "CAD",
                        "type": "SPR",
                    },
                    "productInformationSectionProps": {
                        "measurementsProps": {
                            "measurements": [
                                {"measure": '224 cm (88 1/4 ")', "name": "Width", "type": "00047"},
                                {"measure": '92 cm (36 1/4 ")', "name": "Depth", "type": "00044"},
                                {"measure": "41-55 cm", "name": "Seat height", "type": "00039"},
                                {"measure": "30 kg", "name": "Max. load", "type": "00099"},
                            ]
                        }
                    },
                }
            }
        }
    }
    scripts = [_script("application/ld+json", breadcrumbs), _script("application/ld+json", product)]
    if with_model:
        scripts.append(_script("application/ld+json", model, extra=' id="pip-range-json-ld"'))
    if with_decoy:
        # Some real pages embed another product's hydration data before their own.
        decoy = _script("text/hydrate", _decoy_hydration(), extra=' data-fika-hydration-id="d"')
        scripts.append(decoy)
    if with_hydration:
        scripts.append(_script("text/hydrate", {"unrelated": True}))
        scripts.append(_script("text/hydrate", hydration, extra=' data-fika-hydration-id="x"'))
    return "<!doctype html><html><head></head><body>" + "".join(scripts) + "</body></html>"


def _decoy_hydration() -> dict[str, Any]:
    return {
        "0": {
            "loaderData": {
                "pageProps": {
                    "product": {
                        "itemNo": "99999999",
                        "visibleItemNo": "999.999.99",
                        "name": "OTHER",
                        "price": 131,
                        "currencyCode": "EUR",
                        "type": "SPR",
                    },
                    "productInformationSectionProps": {
                        "measurementsProps": {
                            "measurements": [{"measure": "10 cm", "name": "Width", "type": "00047"}]
                        }
                    },
                }
            }
        }
    }


def _script(script_type: str, data: Any, extra: str = "") -> str:
    return f'<script type="{script_type}"{extra}>{json.dumps(data)}</script>'


SITEMAP_INDEX = """<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<sitemap><loc>https://www.ikea.com/sitemaps/prod-en-CA_1.xml</loc></sitemap>
<sitemap><loc>https://www.ikea.com/sitemaps/cat-en-CA_1.xml</loc></sitemap>
<sitemap><loc>https://www.ikea.com/sitemaps/prod-fr-CA_1.xml</loc></sitemap>
</sitemapindex>"""

PRODUCT_SITEMAP = """<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
<url><loc>https://www.ikea.com/ca/en/p/testa-sofa-gray-s12345678/</loc>
  <image:image><image:loc>https://www.ikea.com/ca/en/images/products/testa.jpg</image:loc></image:image>
</url>
<url><loc>https://www.ikea.com/ca/en/p/testa-chair-white-87654321/</loc></url>
<url><loc>https://www.ikea.com/ca/en/p/testa-sofa-gray-dupe-s12345678/</loc></url>
</urlset>"""

LISTING = {
    "moreProducts": {
        "productWindow": [
            {
                "itemNo": "12345678",
                "pipUrl": "https://www.ikea.com/ca/en/p/testa-sofa-gray-s12345678/",
                "gprDescription": {
                    "variants": [
                        {"pipUrl": "https://www.ikea.com/ca/en/p/testa-sofa-blue-s22345678/"},
                        {"pipUrl": "https://www.ikea.com/ca/en/p/testa-sofa-gray-s12345678/"},
                    ]
                },
            },
            {
                "itemNo": "32345678",
                "pipUrl": "https://www.ikea.com/ca/en/p/testa-loveseat-32345678/",
            },
        ]
    }
}
