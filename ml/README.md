# ml

Python notebooks and scripts that turn layout ratings into better layouts.

The first job (M7) fits the scorer's room weights to the pairwise ratings from `/admin/rate`:
Bradley–Terry on the scorer's own room score, pulled toward the hand-set weights, checked on
homes left out of the fit. The fitted weights go to `data/ml/weights-fitted.json` for a blind
check against the current ones; `--ship` then writes `packages/geometry/weights.json`, which the
scorer and the solver load, but only if they predicted the held-out homes' ratings better.
Later: a learned reward model (LightGBM → ONNX). See PLAN.md, section 7.

```bash
pnpm ratings:export                  # data/ml/ratings.csv and notes.jsonl (gitignored)
cd ml
uv sync
uv run python fit_weights.py         # data/ml/fit-report.md, and data/ml/weights-fitted.json
cd .. && pnpm ratings:pool --compare data/ml/weights-fitted.json   # then /admin/rate?compare=weights-fitted
cd ml && uv run python fit_weights.py --ship                     # if the fitted weights won
uv run python -m unittest            # tests, on ratings made up from known weights
uv run jupyter lab                   # notebooks/01-bradley-terry.ipynb walks through the fit
```
