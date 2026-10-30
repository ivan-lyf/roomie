"""Fit the scorer's room weights to the pairwise ratings (PLAN.md M7).

Bradley–Terry on the scorer's own room score: the chance the rater prefers layout A to layout B
is sigmoid(beta * (s_A - s_B)), where s is a room's score as packages/geometry works it out, the
weighted mean of the features that apply to the room. The weights stay at or above zero and are
pulled toward the hand-set ones, so a hundred ratings nudge them rather than replace them. "About
the same" counts as half a win each way.

The fit is checked by cross-validation grouped by home, so a home's ratings are never in both
training and test: it writes packages/geometry/weights.json only if the fitted weights predict
the held-out homes' ratings better than the hand-set ones (lower log loss, and at least the same
accuracy), and otherwise reports and leaves the file alone. Home weights stay as they are: room
ratings say nothing about them.

    pnpm ratings:export                  # data/ml/ratings.csv and notes.jsonl
    cd ml && uv run python fit_weights.py [--dry-run]
"""

from __future__ import annotations

import argparse
import json
import math
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import minimize
from sklearn.model_selection import GroupKFold

ROOT = Path(__file__).resolve().parent.parent
RATINGS = ROOT / "data" / "ml" / "ratings.csv"
NOTES = ROOT / "data" / "ml" / "notes.jsonl"
WEIGHTS = ROOT / "packages" / "geometry" / "weights.json"
REPORT = ROOT / "data" / "ml" / "fit-report.md"

# How hard the weights are pulled toward the hand-set ones: per squared relative change.
PULL = 0.05
# Fewer decided ratings than this, and nothing is fitted.
MIN_DECIDED = 20
BOOTSTRAPS = 200
# A weight is never fitted to quite nothing, so the feature still breaks ties.
FLOOR = 0.01


def load(path: Path = RATINGS) -> pd.DataFrame:
    return pd.read_csv(path)


def room_features(weights: dict) -> list[str]:
    return list(weights["room"].keys())


def matrices(df: pd.DataFrame, feats: list[str]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Both sides' features (NaN where one doesn't apply), and how often A won: 1, 0 or 0.5."""
    fa = df[[f"a_{f}" for f in feats]].to_numpy(dtype=float)
    fb = df[[f"b_{f}" for f in feats]].to_numpy(dtype=float)
    y = df["winner"].map({"a": 1.0, "b": 0.0, "same": 0.5}).to_numpy(dtype=float)
    return fa, fb, y


def scores(w: np.ndarray, f: np.ndarray) -> np.ndarray:
    """Each room's score as the scorer works it out: the weighted mean of the features it has."""
    present = ~np.isnan(f)
    total = (present * w).sum(axis=1)
    weighted = np.where(present, np.nan_to_num(f) * w, 0.0).sum(axis=1)
    return np.divide(weighted, total, out=np.zeros_like(total), where=total > 0)


def sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-x))


def log_loss(w: np.ndarray, beta: float, fa, fb, y) -> float:
    p = np.clip(sigmoid(beta * (scores(w, fa) - scores(w, fb))), 1e-9, 1 - 1e-9)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def accuracy(w: np.ndarray, fa, fb, y) -> float:
    """Of the ratings with a winner, how many the scores pick; a tie counts half."""
    decided = y != 0.5
    if not decided.any():
        return math.nan
    d = scores(w, fa[decided]) - scores(w, fb[decided])
    right = np.where(d == 0, 0.5, ((d > 0) == (y[decided] == 1)).astype(float))
    return float(right.mean())


def fit(fa, fb, y, w0: np.ndarray, *, learn_weights: bool = True, pull: float = PULL):
    """The weights and scale that best explain the ratings; with learn_weights off, the scale only."""

    def objective(params: np.ndarray) -> float:
        w = params[:-1] if learn_weights else w0
        beta = params[-1]
        penalty = pull * np.sum(((w - w0) / w0) ** 2) if learn_weights else 0.0
        return log_loss(w, beta, fa, fb, y) + penalty

    start = np.append(w0, 10.0) if learn_weights else np.array([10.0])
    bounds = ([(FLOOR, None)] * len(w0) if learn_weights else []) + [(0.1, 500.0)]
    result = minimize(objective, start, method="L-BFGS-B", bounds=bounds)
    w = result.x[:-1] if learn_weights else w0.copy()
    return w, float(result.x[-1])


def cross_validate(df: pd.DataFrame, feats: list[str], w0: np.ndarray, pull: float = PULL) -> dict:
    """Held-out log loss and accuracy of the hand-set and fitted weights, a home at a time out."""
    homes = df["home"].to_numpy()
    folds = GroupKFold(n_splits=min(5, len(set(homes))))
    fa, fb, y = matrices(df, feats)
    out = {"hand": {"loss": [], "acc": []}, "fitted": {"loss": [], "acc": []}, "n": []}
    for train, test in folds.split(fa, y, homes):
        _, beta0 = fit(fa[train], fb[train], y[train], w0, learn_weights=False)
        w, beta = fit(fa[train], fb[train], y[train], w0, pull=pull)
        for name, weights, scale in (("hand", w0, beta0), ("fitted", w, beta)):
            out[name]["loss"].append(log_loss(weights, scale, fa[test], fb[test], y[test]))
            out[name]["acc"].append(accuracy(weights, fa[test], fb[test], y[test]))
        out["n"].append(len(test))
    n = np.array(out["n"], dtype=float)

    def mean(xs):
        xs = np.array(xs, dtype=float)
        keep = ~np.isnan(xs)
        return float(np.average(xs[keep], weights=n[keep])) if keep.any() else math.nan

    return {name: {k: mean(v) for k, v in out[name].items()} for name in ("hand", "fitted")}


def bootstrap(df: pd.DataFrame, feats, w0, runs: int = BOOTSTRAPS, seed: int = 1) -> np.ndarray:
    """The fitted weights again on homes drawn with replacement: each row one run."""
    rng = np.random.default_rng(seed)
    homes = df["home"].unique()
    runs_w = []
    for _ in range(runs):
        drawn = rng.choice(homes, size=len(homes), replace=True)
        sample = pd.concat([df[df["home"] == h] for h in drawn])
        fa, fb, y = matrices(sample, feats)
        runs_w.append(fit(fa, fb, y, w0)[0])
    return np.array(runs_w)


def blamed(df: pd.DataFrame, feats: list[str]) -> dict[str, int]:
    """How often the notes, as read, blame each feature, and how often none ('none')."""
    counts = {f: 0 for f in [*feats, "none"]}
    for cell in df["label_features"].fillna(""):
        for f in str(cell).split("|"):
            if f in counts:
                counts[f] += 1
    return counts


def unmeasured(path: Path = NOTES) -> list[str]:
    """The rules the notes imply about problems no feature measures, as read."""
    if not path.exists():
        return []
    rules = []
    for line in path.read_text().splitlines():
        labels = (json.loads(line).get("labels") or {}).get("labels", [])
        rules += [l["rule"] or l["problem"] for l in labels if l["feature"] is None]
    return rules


def scaled(w: np.ndarray, w0: np.ndarray) -> np.ndarray:
    """The weights scaled to the hand-set total, which leaves every score the same."""
    return w * (w0.sum() / w.sum())


def report(df, feats, w0, w, cv, spread, blame, rules) -> str:
    decided = int((df["winner"] != "same").sum())
    lines = [
        f"# Scorer weights fitted to ratings, {date.today().isoformat()}",
        "",
        f"{len(df)} ratings ({decided} with a winner) of {df['room_id'].nunique()} rooms "
        f"in {df['home'].nunique()} homes.",
        "",
        "| Held out, a home at a time | Log loss | Accuracy |",
        "|---|---|---|",
        f"| Hand-set weights | {cv['hand']['loss']:.3f} | {cv['hand']['acc']:.0%} |",
        f"| Fitted weights | {cv['fitted']['loss']:.3f} | {cv['fitted']['acc']:.0%} |",
        "",
        "| Feature | Hand-set | Fitted | 90% of bootstraps | Notes blame it |",
        "|---|---|---|---|---|",
    ]
    lo, hi = np.percentile(spread, [5, 95], axis=0) if len(spread) else (w, w)
    for i, f in enumerate(feats):
        lines.append(
            f"| {f} | {w0[i]:.2f} | {w[i]:.2f} | {lo[i]:.2f}–{hi[i]:.2f} | {blame.get(f, 0)} |"
        )
    lines += ["", f"Notes blame no feature {blame.get('none', 0)} times."]
    if rules:
        lines += ["", "What the notes say that no feature measures:", ""]
        lines += [f"- {r}" for r in rules]
    return "\n".join(lines) + "\n"


def better(cv: dict) -> bool:
    """Whether the fitted weights did better on held-out homes: lower loss, accuracy no worse."""
    hand, fitted = cv["hand"], cv["fitted"]
    return fitted["loss"] < hand["loss"] and not fitted["acc"] < hand["acc"]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--ratings", type=Path, default=RATINGS)
    parser.add_argument("--notes", type=Path, default=NOTES)
    parser.add_argument("--weights", type=Path, default=WEIGHTS)
    parser.add_argument("--report", type=Path, default=REPORT)
    parser.add_argument("--pull", type=float, default=PULL)
    parser.add_argument("--bootstraps", type=int, default=BOOTSTRAPS)
    parser.add_argument("--dry-run", action="store_true", help="report only; never write weights")
    args = parser.parse_args()

    weights = json.loads(args.weights.read_text())
    feats = room_features(weights)
    w0 = np.array([weights["room"][f] for f in feats], dtype=float)
    df = load(args.ratings)
    decided = int((df["winner"] != "same").sum())
    if decided < MIN_DECIDED:
        print(f"{decided} ratings with a winner: fitting needs at least {MIN_DECIDED}.")
        return

    fa, fb, y = matrices(df, feats)
    w, _ = fit(fa, fb, y, w0, pull=args.pull)
    w = scaled(w, w0)
    cv = cross_validate(df, feats, w0, pull=args.pull)
    spread = np.array([scaled(run, w0) for run in bootstrap(df, feats, w0, args.bootstraps)])
    text = report(df, feats, w0, w, cv, spread, blamed(df, feats), unmeasured(args.notes))
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(text)
    print(text)

    if not better(cv):
        print("The fitted weights don't beat the hand-set ones on held-out homes: left as they are.")
        return
    if args.dry_run:
        print("They do better on held-out homes; --dry-run, so weights.json is left as it is.")
        return
    weights["room"] = {f: round(float(v), 2) for f, v in zip(feats, w)}
    weights["source"] = (
        f"fitted by ml/fit_weights.py on {date.today().isoformat()} from {len(df)} ratings; "
        f"held-out accuracy {cv['fitted']['acc']:.0%} against {cv['hand']['acc']:.0%} hand-set"
    )
    args.weights.write_text(json.dumps(weights, indent=2) + "\n")
    print(f"Wrote {args.weights}.")


if __name__ == "__main__":
    main()
