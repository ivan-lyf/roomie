from datetime import UTC, datetime

from pages import MODEL_URL, PRODUCT_URL, product_page

from ikea_scraper.parse import keep_product_data, parse_product_page

SCRAPED_AT = datetime(2026, 10, 21, 12, 0, tzinfo=UTC)


def test_extracts_the_item_record() -> None:
    item = parse_product_page(product_page(), PRODUCT_URL, SCRAPED_AT)
    assert item is not None
    assert item["itemNo"] == "12345678"
    assert item["articleNo"] == "123.456.78"
    assert item["itemType"] == "SPR"
    assert item["name"] == "TESTA Sofa - Gray"
    assert item["productName"] == "TESTA"
    assert item["priceCad"] == 799.0
    assert item["currency"] == "CAD"
    assert item["availability"] == "InStock"
    assert item["imageUrl"] == "https://www.ikea.com/ca/en/images/products/testa.jpg"
    assert item["modelUrl"] == MODEL_URL
    assert item["scrapedAt"] == "2026-10-21T12:00:00+00:00"


def test_category_path_is_ordered_and_skips_the_root() -> None:
    item = parse_product_page(product_page(), PRODUCT_URL, SCRAPED_AT)
    assert item is not None
    assert item["categoryPath"] == [
        {"id": "700640", "name": "Sofas & armchairs"},
        {"id": "fu003", "name": "Sofas"},
    ]


def test_measurements_are_converted_to_meters() -> None:
    item = parse_product_page(product_page(), PRODUCT_URL, SCRAPED_AT)
    assert item is not None
    by_name = {m["name"]: m for m in item["measurements"]}
    assert by_name["Width"]["minM"] == 2.24
    assert by_name["Width"]["text"] == '224 cm (88 1/4 ")'
    assert (by_name["Seat height"]["minM"], by_name["Seat height"]["maxM"]) == (0.41, 0.55)
    assert by_name["Max. load"]["minM"] is None


def test_model_url_is_optional() -> None:
    item = parse_product_page(product_page(with_model=False), PRODUCT_URL, SCRAPED_AT)
    assert item is not None
    assert item["modelUrl"] is None


def test_falls_back_to_json_ld_without_hydration_data() -> None:
    item = parse_product_page(product_page(with_hydration=False), PRODUCT_URL, SCRAPED_AT)
    assert item is not None
    assert item["itemNo"] == "12345678"
    assert item["articleNo"] == "123.456.78"
    assert item["itemType"] == "SPR"
    assert item["priceCad"] == 799.0
    assert item["measurements"] == []


def test_returns_none_without_product_data() -> None:
    assert parse_product_page("<html><body>gone</body></html>", PRODUCT_URL, SCRAPED_AT) is None


def test_trimmed_page_parses_the_same() -> None:
    page = product_page()
    trimmed = keep_product_data(page)
    assert '"unrelated"' not in trimmed
    assert len(trimmed) < len(page)
    assert parse_product_page(trimmed, PRODUCT_URL, SCRAPED_AT) == parse_product_page(
        page, PRODUCT_URL, SCRAPED_AT
    )


def test_ignores_hydration_data_for_other_products() -> None:
    item = parse_product_page(product_page(with_decoy=True), PRODUCT_URL, SCRAPED_AT)
    assert item is not None
    assert (item["itemNo"], item["productName"], item["currency"]) == ("12345678", "TESTA", "CAD")
    assert item["measurements"][0]["minM"] == 2.24


def test_uses_json_ld_only_when_no_hydration_data_matches() -> None:
    page = product_page(with_hydration=False, with_decoy=True)
    item = parse_product_page(page, PRODUCT_URL, SCRAPED_AT)
    assert item is not None
    assert item["itemNo"] == "12345678"
    assert item["articleNo"] == "123.456.78"
    assert item["currency"] == "CAD"
    assert item["measurements"] == []
