"""Tests for fit_weights.py, on ratings made up from known weights: uv run python -m unittest."""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

import fit_weights as fw

WEIGHTS = json.loads(fw.WEIGHTS.read_text())
FEATS = fw.room_features(WEIGHTS)
W0 = np.array([WEIGHTS["room"][f] for f in FEATS], dtype=float)


def made_up(true_w: np.ndarray, pairs: int = 400, homes: int = 25, seed: int = 3) -> pd.DataFrame:
    """Pairs of rooms whose ratings follow true_w; each room lacks a few features, on both sides."""
    rng = np.random.default_rng(seed)
    rows = []
    for i in range(pairs):
        lacks = rng.random(len(FEATS)) < 0.3
        fa, fb = rng.random(len(FEATS)), rng.random(len(FEATS))
        fa[lacks] = np.nan
        fb[lacks] = np.nan
        d = fw.scores(true_w, fa[None])[0] - fw.scores(true_w, fb[None])[0]
        p = fw.sigmoid(np.array(25 * d))
        winner = "same" if rng.random() < 0.1 else ("a" if rng.random() < p else "b")
        row = {"home": f"h{i % homes}", "room_id": f"r{i % 3}", "winner": winner}
        row["label_features"] = "tv_view|none" if i % 10 == 0 else ""
        for j, f in enumerate(FEATS):
            row[f"a_{f}"] = fa[j]
            row[f"b_{f}"] = fb[j]
        rows.append(row)
    return pd.DataFrame(rows)


class FitWeights(unittest.TestCase):
    def test_scores_like_the_scorer(self):
        # The weighted mean of the features a room has.
        f = np.array([[1.0, 0.0, np.nan], [np.nan, np.nan, np.nan]])
        w = np.array([3.0, 1.0, 5.0])
        np.testing.assert_allclose(fw.scores(w, f), [0.75, 0.0])

    def test_learns_what_the_ratings_weigh(self):
        true_w = W0.copy()
        tv, spread = FEATS.index("tv_view"), FEATS.index("spread")
        true_w[tv] *= 4
        true_w[spread] = 0.05
        df = made_up(true_w)
        fa, fb, y = fw.matrices(df, FEATS)
        w, _ = fw.fit(fa, fb, y, W0)
        w = fw.scaled(w, W0)
        target = fw.scaled(true_w, W0)
        # Pulled toward the hand-set weights, but each moves the way the ratings say.
        self.assertGreater(w[tv], W0[tv])
        self.assertLess(w[spread], W0[spread])
        self.assertLess(abs(w[tv] - target[tv]), abs(W0[tv] - target[tv]))
        cv = fw.cross_validate(df, FEATS, W0)
        self.assertLess(cv["fitted"]["loss"], cv["hand"]["loss"])
        self.assertTrue(fw.better(cv))

    def test_counts_blame_and_unmeasured_rules(self):
        df = made_up(W0, pairs=20)
        self.assertEqual(fw.blamed(df, FEATS)["tv_view"], 2)
        self.assertEqual(fw.blamed(df, FEATS)["none"], 2)
        with tempfile.TemporaryDirectory() as d:
            notes = Path(d) / "notes.jsonl"
            label = {"feature": None, "rule": "Leave room by the door.", "problem": "blocks"}
            notes.write_text(json.dumps({"labels": {"labels": [label]}}) + "\n")
            self.assertEqual(fw.unmeasured(notes), ["Leave room by the door."])

    def test_writes_weights_only_when_better_and_not_dry(self):
        true_w = W0.copy()
        true_w[FEATS.index("walkway")] *= 5
        with tempfile.TemporaryDirectory() as d:
            ratings, weights, report = Path(d) / "r.csv", Path(d) / "w.json", Path(d) / "r.md"
            made_up(true_w).to_csv(ratings, index=False)
            weights.write_text(json.dumps(WEIGHTS))
            run = lambda *extra: subprocess.run(  # noqa: E731
                [sys.executable, "fit_weights.py", "--ratings", str(ratings), "--weights",
                 str(weights), "--report", str(report), "--notes", str(Path(d) / "none"),
                 "--bootstraps", "5", *extra],
                capture_output=True, text=True, check=True, cwd=Path(__file__).parent,
            )
            dry = run("--dry-run")
            self.assertIn("--dry-run", dry.stdout)
            self.assertEqual(json.loads(weights.read_text()), WEIGHTS)
            self.assertIn("| walkway |", report.read_text())
            run()
            written = json.loads(weights.read_text())
            self.assertGreater(written["room"]["walkway"], WEIGHTS["room"]["walkway"])
            self.assertEqual(written["home"], WEIGHTS["home"])
            self.assertAlmostEqual(sum(written["room"].values()), sum(WEIGHTS["room"].values()), 1)
            self.assertIn("fitted by ml/fit_weights.py", written["source"])

    def test_fits_nothing_on_too_few_ratings(self):
        with tempfile.TemporaryDirectory() as d:
            ratings = Path(d) / "r.csv"
            made_up(W0, pairs=10).to_csv(ratings, index=False)
            out = subprocess.run(
                [sys.executable, "fit_weights.py", "--ratings", str(ratings), "--dry-run"],
                capture_output=True, text=True, check=True, cwd=Path(__file__).parent,
            )
            self.assertIn("fitting needs at least 20", out.stdout)


if __name__ == "__main__":
    unittest.main()
