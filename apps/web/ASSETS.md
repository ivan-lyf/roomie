# Third-party assets

Everything in `public/textures` and `public/env` comes from [Poly Haven](https://polyhaven.com),
released under [CC0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain, no
attribution required; credited here anyway). Each was downloaded at 1K and resized for the web.

## Floor textures (`public/textures/floor`)

Color maps at 1024 px (carpet 512 px) and roughness maps at half that, as JPEG. `size` is the
real-world width one tile covers, used to lay them out in meters.

| File prefix | Poly Haven asset | Authors | Size |
| --- | --- | --- | --- |
| `light_oak` | [laminate_floor_02](https://polyhaven.com/a/laminate_floor_02) | Dario Barresi, Charlotte Baglioni | 1.7 m |
| `dark_oak` | [wood_floor](https://polyhaven.com/a/wood_floor) | Dimitrios Savva | 1.7 m |
| `tile` | [marble_01](https://polyhaven.com/a/marble_01) | Rob Tuytel | 1.5 m |
| `concrete` | [concrete_floor_worn_001](https://polyhaven.com/a/concrete_floor_worn_001) | Dimitrios Savva, Rico Cilliers | 3 m |
| `carpet` | [poly_wool_herringbone](https://polyhaven.com/a/poly_wool_herringbone) | colormass, Rico Cilliers | 0.27 m |

## Environment light (`public/env/lebombo-512.hdr`)

[Lebombo](https://polyhaven.com/a/lebombo) (an empty house in soft daylight), downsampled from
1024 × 512 to 512 × 256 in linear light, keeping the RGBE format. It only lights the scene and is
never shown, so the low resolution doesn't show.
