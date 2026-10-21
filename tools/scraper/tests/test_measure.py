import pytest

from ikea_scraper.measure import Length, parse_length


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ('224 cm (88 1/4 ")', Length(2.24, 2.24)),
        ("41-55 cm", Length(0.41, 0.55)),
        ("41 - 55 cm", Length(0.41, 0.55)),
        ("6 mm", Length(0.006, 0.006)),
        ("1.5 m", Length(1.5, 1.5)),
        ("2,5 cm", Length(0.025, 0.025)),
        ('36 "', Length(0.9144, 0.9144)),
        ('1/2"', Length(0.0127, 0.0127)),
        ('10 1/2 "', Length(0.2667, 0.2667)),
    ],
)
def test_parses_lengths_to_meters(text: str, expected: Length) -> None:
    assert parse_length(text) == expected


@pytest.mark.parametrize("text", ["30 kg (66 lb)", "2.5 m²", "12 l", "", "Width"])
def test_returns_none_for_non_lengths(text: str) -> None:
    assert parse_length(text) is None
