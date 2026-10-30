# ml

Python notebooks and scripts that turn layout ratings into better layouts.

The first job (M7) fits the scorer's room weights to the pairwise ratings from `/admin/rate`:
Bradley–Terry on the scorer's own room score, pulled toward the hand-set weights, checked on
homes left out of the fit. It writes `packages/geometry/weights.json`, which the scorer and the
solver load, only when the fitted weights predict the held-out homes' ratings better. Later: a
learned reward model (LightGBM → ONNX). See PLAN.md, section 7.

```bash
pnpm ratings:export                  # data/ml/ratings.csv and notes.jsonl (gitignored)
cd ml
uv sync
uv run python fit_weights.py         # the report in data/ml/fit-report.md; --dry-run to only report
uv run python -m unittest            # tests, on ratings made up from known weights
uv run jupyter lab                   # notebooks/01-bradley-terry.ipynb walks through the fit
```
