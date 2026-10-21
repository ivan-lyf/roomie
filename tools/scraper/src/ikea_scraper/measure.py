"""Parse IKEA measurement text into meters.

The scraper is the unit boundary: everything downstream of it works in meters.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_NUM = r"\d+(?:[.,]\d+)?"
_METRIC = re.compile(
    rf"^\s*(?P<min>{_NUM})(?:\s*[-–]\s*(?P<max>{_NUM}))?\s*(?P<unit>mm|cm|m)(?![\w²³])"
)
_INCHES = re.compile(r'^\s*(?P<whole>\d+)?\s*(?:(?P<num>\d+)/(?P<den>\d+))?\s*(?:"|″|in\b)')

_TO_METERS = {"mm": 0.001, "cm": 0.01, "m": 1.0}
INCH_M = 0.0254


@dataclass(frozen=True)
class Length:
    min_m: float
    max_m: float


def _num(text: str) -> float:
    return float(text.replace(",", "."))


def parse_length(text: str) -> Length | None:
    """Parse '224 cm (88 1/4 ")', '41-55 cm' or '36 "' into meters.

    Returns None when the text isn't a length (weights, volumes, areas).
    """
    m = _METRIC.match(text)
    if m:
        factor = _TO_METERS[m["unit"]]
        lo = _num(m["min"]) * factor
        hi = _num(m["max"]) * factor if m["max"] else lo
        return Length(round(lo, 4), round(hi, 4))
    m = _INCHES.match(text)
    if m and (m["whole"] or m["num"]):
        inches = float(m["whole"] or 0)
        if m["num"]:
            inches += int(m["num"]) / int(m["den"])
        meters = round(inches * INCH_M, 4)
        return Length(meters, meters)
    return None
