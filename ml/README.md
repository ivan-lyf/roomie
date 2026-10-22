# ml

Python notebooks and scripts that turn layout ratings into better layouts.

The first job (M7) is fitting a Bradley–Terry model on scorer features from the pairwise
ratings, and writing the result to `packages/geometry/weights.json`, which the scorer loads.
Later: a learned reward model (LightGBM → ONNX). See PLAN.md, section 7.

```bash
cd ml
uv sync
uv run jupyter lab
```
