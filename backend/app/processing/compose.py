"""Theme builders turning Sentinel-2 bands into RGB arrays."""
from __future__ import annotations

import logging
import os
from typing import Sequence

import dask.array as da
from dask.base import is_dask_collection
import numpy as np
from skimage import exposure
from sklearn.decomposition import NMF, PCA
import xarray as xr

LOGGER = logging.getLogger(__name__)
def _select(stack: xr.DataArray, bands: Sequence[str]) -> xr.DataArray:
    return stack.sel(band=list(bands))


def _as_numpy(arr) -> np.ndarray:
    if isinstance(arr, xr.DataArray):
        arr = arr.data
    if is_dask_collection(arr):
        arr = arr.compute()
    return np.asarray(arr)


def _safe_divide(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    return np.divide(a, b, out=np.zeros_like(a), where=b != 0)


def _standardize(arr: np.ndarray, mean: np.ndarray, std: np.ndarray) -> np.ndarray:
    return (arr - mean) / (std + 1e-6)


def _to_dask(arr, chunks: tuple[int, ...] | None = None) -> da.Array:
    if isinstance(arr, da.Array):
        return arr
    np_arr = np.asarray(arr)
    shape_chunks = chunks or np_arr.shape
    return da.from_array(np_arr, chunks=shape_chunks)


def compose_true_color(stack: xr.DataArray) -> np.ndarray:
    return _as_numpy(_select(stack, ["B04", "B03", "B02"]))


def compose_false_color(stack: xr.DataArray) -> np.ndarray:
    return _as_numpy(_select(stack, ["B08", "B04", "B03"]))


def compose_geology(stack: xr.DataArray) -> np.ndarray:
    return _as_numpy(_select(stack, ["B12", "B11", "B04"]))


NDVI_STOPS = np.array([-0.2, 0.0, 0.2, 0.4, 0.6, 0.8], dtype="float32")
NDVI_COLORS = np.array(
    [
        [0.2, 0.2, 0.6],
        [0.0, 0.4, 0.8],
        [0.2, 0.7, 0.2],
        [0.6, 0.8, 0.2],
        [0.8, 0.6, 0.2],
        [0.9, 0.3, 0.3],
    ],
    dtype="float32",
)


def _ramp_color(values: np.ndarray) -> np.ndarray:
    flat = values.flatten()
    result = np.zeros((flat.shape[0], 3), dtype="float32")
    for idx, val in enumerate(flat):
        if val <= NDVI_STOPS[0]:
            result[idx] = NDVI_COLORS[0]
            continue
        if val >= NDVI_STOPS[-1]:
            result[idx] = NDVI_COLORS[-1]
            continue
        hi = np.searchsorted(NDVI_STOPS, val)
        lo = hi - 1
        frac = (val - NDVI_STOPS[lo]) / (NDVI_STOPS[hi] - NDVI_STOPS[lo])
        result[idx] = NDVI_COLORS[lo] * (1 - frac) + NDVI_COLORS[hi] * frac
    return result.reshape((*values.shape, 3)).transpose(2, 0, 1)


def compose_ndvi(stack: xr.DataArray) -> np.ndarray:
    data = _select(stack, ["B08", "B04"])
    nir, red = _as_numpy(data)
    ndvi = _safe_divide(nir - red, nir + red)
    return _ramp_color(ndvi)


def _valid_mask(arr_bxy: da.Array) -> da.Array:
    return da.isfinite(arr_bxy).all(axis=0)


def _sample_pixels(
    arr_bxy: da.Array, mask: da.Array, max_samples: int = 250_000, seed: int = 0
) -> np.ndarray | None:
    _, _, width = arr_bxy.shape
    decimated = mask[::8, ::8]
    yy, xx = np.nonzero(decimated.compute())
    if yy.size == 0:
        return None
    rng = np.random.RandomState(seed)
    take = int(min(max_samples // 64, yy.size))
    idx = rng.choice(yy.size, size=take, replace=False)
    yy = (yy[idx] * 8).astype(np.int64)
    xx = (xx[idx] * 8).astype(np.int64)
    flat = (yy * int(width)) + xx
    rows: list[np.ndarray] = []
    for band in range(int(arr_bxy.shape[0])):
        gathered = da.take(arr_bxy[band].ravel(), flat).compute()
        rows.append(gathered)
    samples = np.stack(rows, axis=1).astype("float32")
    samples = samples[np.isfinite(samples).all(axis=1)]
    return samples if samples.size else None


def _stabilize_sign(arr3: da.Array) -> da.Array:
    result = arr3
    for idx in range(3):
        sample = result[idx, ::16, ::16].compute()
        med = np.nanmedian(sample)
        if med < 0:
            result[idx] = -result[idx]
    return result


def _sym_scale(arr3: da.Array, p: float = 99.0) -> da.Array:
    sample = arr3[:, ::8, ::8]
    span = da.nanpercentile(da.fabs(sample), p, axis=(1, 2)) + 1e-6
    return da.clip(arr3 / span[:, None, None], -1, 1)


def _get_palette_matrix(name: str = "vivid") -> np.ndarray:
    rng = np.random.default_rng(0)
    presets = {
        "vivid": np.array([[0.0, 1.0, 0.5], [0.5, 0.0, 1.0], [1.0, 0.5, 0.0]], dtype="float32"),
        "cool": np.array([[0.0, 0.8, 1.0], [0.4, 0.1, 0.7], [0.1, 0.4, 1.0]], dtype="float32"),
        "warm": np.array([[1.0, 0.6, 0.1], [1.0, 0.2, 0.0], [0.8, 0.3, 0.0]], dtype="float32"),
        "neutral": np.eye(3, dtype="float32"),
        "neon": np.array([[0.2, 1.0, 1.0], [1.0, 0.2, 0.8], [0.2, 0.4, 1.0]], dtype="float32"),
        "random": rng.uniform(0.1, 1.0, (3, 3)).astype("float32"),
    }
    return presets.get(name, presets["vivid"])


def _apply_mix(arr3: da.Array, matrix: np.ndarray) -> da.Array:
    arr = arr3.rechunk({0: -1, 1: -1, 2: -1})
    mat = matrix.astype("float32")

    def _blk(block):
        reshaped = block.reshape(3, -1)
        mixed = (mat @ reshaped).reshape(block.shape)
        return mixed.astype(block.dtype)

    return da.map_blocks(_blk, arr, dtype=arr.dtype)


def _vivid_rgb(
    arr3: da.Array, sat: float = 1.5, gamma: float = 0.9, clahe_clip: float = 0.006
) -> da.Array:
    arr3 = arr3.rechunk({0: -1})
    import numpy as _np
    from skimage.color import hsv2rgb, rgb2hsv

    def _blk(block):
        rgb = _np.moveaxis(_np.clip((block + 1) * 0.5, 0, 1), 0, -1)
        hsv = rgb2hsv(rgb)
        hsv[..., 1] = _np.clip(hsv[..., 1] * sat, 0, 1)
        hsv[..., 2] = exposure.equalize_adapthist(hsv[..., 2], clip_limit=clahe_clip)
        out = hsv2rgb(hsv) ** gamma
        return _np.moveaxis(out.astype(_np.float32), -1, 0)

    return da.map_blocks(_blk, arr3, dtype=np.float32, chunks=arr3.chunks)


def _bands_dict(stack: xr.DataArray) -> dict[str, da.Array]:
    coord = stack.coords.get("band")
    if coord is None:
        names = [str(idx) for idx in range(stack.shape[0])]
    else:
        names = [str(val) for val in coord.values]
    data = stack.data
    result: dict[str, da.Array] = {}
    for idx, name in enumerate(names):
        value = data[idx]
        result[name] = _to_dask(value, chunks=value.shape if hasattr(value, "shape") else None)
    return result


def _ndvi(b8, b4):
    return (b8 - b4) / (b8 + b4 + 1e-6)


def _ndwi(b3, b8):
    return (b3 - b8) / (b3 + b8 + 1e-6)


def _ndbi(b11, b8):
    return (b11 - b8) / (b11 + b8 + 1e-6)


def _gci(b8, b3):
    return (b8 / (b3 + 1e-6)) - 1.0


def _nbr(b8, b12):
    return (b8 - b12) / (b8 + b12 + 1e-6)


def _savi(b8, b4):
    return ((b8 - b4) / (b8 + b4 + 0.5)) * 1.5


def _wri(b3, b4, b8, b11):
    return (b3 + b4) / (b8 + b11 + 1e-6)


def compose_decorr(stack: xr.DataArray, palette: str = "vivid", triplet: tuple[str, str, str] | None = None) -> np.ndarray:
    bands = _bands_dict(stack)
    triplet = triplet or ("B12", "B08", "B04")
    try:
        arrays = [bands[key] for key in triplet]
    except KeyError as exc:  # pragma: no cover - defensive
        raise ValueError(f"Missing band {exc.args[0]} for decorrelation stretch") from exc
    cube = da.stack(arrays, axis=0).astype("float32").rechunk({0: -1})
    sample = cube[:, ::8, ::8].compute().reshape(3, -1)
    sample = sample[:, np.isfinite(sample).all(axis=0)]
    height, width = int(stack.sizes.get("y", cube.shape[1])), int(stack.sizes.get("x", cube.shape[2]))
    min_required = max(10, min(500, height * width))
    if sample.shape[1] < min_required:
        LOGGER.warning("Decorr: insufficient valid pixels; returning zeros")
        return np.zeros((3, height, width), dtype="float32")
    mu = sample.mean(axis=1)
    centered = sample - mu[:, None]
    cov = np.cov(centered) + 1e-6 * np.eye(3)
    try:
        lam, U = np.linalg.eigh(cov)
    except np.linalg.LinAlgError:
        LOGGER.warning("Decorr: eigenvalues failed to converge; returning zeros")
        return np.zeros((3, height, width), dtype="float32")
    W = (U @ np.diag(1.0 / np.sqrt(lam)) @ U.T).astype("float32")
    Wd = da.from_array(W, chunks=W.shape)
    delta = cube - mu.astype("float32")[:, None, None]
    Z = da.tensordot(Wd, delta, axes=((1), (0)))
    Z = _sym_scale(Z, p=99)
    Z = _apply_mix(Z, _get_palette_matrix(palette))
    Z = _sym_scale(Z, p=99)
    rgb = _vivid_rgb(Z, sat=1.5, gamma=0.9, clahe_clip=0.006)
    return da.clip(rgb, 0, 1).astype("float32")


def compose_nmf(stack: xr.DataArray, palette: str = "vivid") -> np.ndarray:
    arr = stack.data
    if not is_dask_collection(arr):
        arr = da.from_array(np.asarray(arr, dtype="float32"), chunks=arr.shape)
    bands, height, width = arr.shape
    sub = arr[:, ::8, ::8]
    sample = sub.reshape((bands, -1)).compute().T
    sample = sample[np.isfinite(sample).all(axis=1)]
    if sample.shape[0] < 2000:
        full = arr.reshape((bands, -1)).compute().T
        full = full[np.isfinite(full).all(axis=1)]
        sample = full
    min_required = min(500, height * width)
    if sample.shape[0] < min_required:
        LOGGER.warning("NMF: insufficient valid pixels; returning zeros")
        return np.zeros((3, height, width), dtype="float32")
    sample = sample - sample.min(axis=0, keepdims=True)
    sample = np.clip(sample, 0, None).astype("float32")
    # Increase max_iter to reduce ConvergenceWarning on larger scenes.
    nmf = NMF(n_components=3, init="nndsvd", random_state=0, max_iter=500)
    nmf.fit(sample)
    weights = nmf.components_.astype("float32")
    mins = da.nanmin(arr, axis=(1, 2)).reshape((bands, 1, 1))
    arr_pos = da.clip(arr - mins, 0, None).rechunk({0: -1})
    Wd = da.from_array(weights, chunks=weights.shape).rechunk({1: -1})
    comp = da.tensordot(Wd, arr_pos, axes=((1), (0))).astype("float32")
    comp = _sym_scale(comp, p=99)
    comp = _apply_mix(comp, _get_palette_matrix(palette))
    comp = _sym_scale(comp, p=99)
    rgb = _vivid_rgb(comp, sat=1.4, gamma=0.95, clahe_clip=0.006)
    return da.clip(rgb, 0, 1).astype("float32")


def compose_index_triplet(stack: xr.DataArray, pack: str = "veg", palette: str = "vivid") -> np.ndarray:
    bands = _bands_dict(stack)
    required = {"B02", "B03", "B04", "B08", "B11", "B12"}
    missing = [band for band in required if band not in bands]
    if missing:  # pragma: no cover - defensive
        raise ValueError(f"Missing bands for index pack: {', '.join(missing)}")
    ndvi = _ndvi(bands["B08"], bands["B04"])
    ndwi = _ndwi(bands["B03"], bands["B08"])
    ndbi = _ndbi(bands["B11"], bands["B08"])
    gci = _gci(bands["B08"], bands["B03"])
    nbr = _nbr(bands["B08"], bands["B12"])
    savi = _savi(bands["B08"], bands["B04"])
    wri = _wri(bands["B03"], bands["B04"], bands["B08"], bands["B11"])
    if pack == "aqua":
        components = da.stack(
            [ndwi, bands["B03"] / (bands["B02"] + 1e-6), bands["B11"] / (bands["B08"] + 1e-6)],
            axis=0,
        )
    elif pack == "urban":
        components = da.stack([ndbi, savi, wri], axis=0)
    else:
        components = da.stack([ndvi, gci, nbr], axis=0)
    components = components.astype("float32")
    components = _sym_scale(components, p=99)
    components = _apply_mix(components, _get_palette_matrix(palette))
    components = _sym_scale(components, p=99)
    rgb = _vivid_rgb(components, sat=1.4, gamma=0.92, clahe_clip=0.006)
    return da.clip(rgb, 0, 1).astype("float32")


def compose_pca(stack: xr.DataArray, palette: str = "vivid") -> np.ndarray:
    bands = _select(stack, ["B02", "B03", "B04", "B08", "B11", "B12"]).astype("float32")
    arr = bands.data
    if not is_dask_collection(arr):
        arr = da.from_array(
            np.asarray(arr, dtype="float32"),
            chunks=(
                arr.shape[0],
                min(1024, arr.shape[1]),
                min(1024, arr.shape[2]),
            ),
        )
    valid = _valid_mask(arr)
    max_samples = int(os.getenv("EA_PCA_SAMPLES", "20000"))
    samples = _sample_pixels(arr, valid, max_samples=max_samples, seed=0)

    if samples is None or samples.shape[0] < 5000:
        fallback = arr.compute()
        reshaped = fallback.reshape(fallback.shape[0], -1).T
        reshaped = reshaped[np.isfinite(reshaped).all(axis=1)]
        samples = reshaped
        required = min(1000, arr.shape[1] * arr.shape[2])
        if samples.shape[0] < required:
            LOGGER.info(
                "PCA: insufficient valid pixels; falling back to simple scaling",
                extra={"sample_count": int(samples.shape[0]), "required": int(required)},
            )

            def _scale_channelwise(img: np.ndarray) -> np.ndarray:
                p2 = np.nanpercentile(img, 2, axis=(1, 2), keepdims=True)
                p98 = np.nanpercentile(img, 98, axis=(1, 2), keepdims=True)
                span = np.clip(p98 - p2, 1e-6, None)
                scaled = np.clip((img - p2) / span, 0, 1)
                return np.nan_to_num(scaled, nan=0.0, posinf=1.0, neginf=0.0).astype(
                    "float32"
                )

            fallback_rgb = fallback[[2, 1, 0], :, :]
            return _scale_channelwise(fallback_rgb)

    mu = samples.mean(axis=0, dtype=np.float64)
    sigma = samples.std(axis=0, dtype=np.float64) + 1e-6
    standardized = (samples - mu) / sigma

    pca = PCA(n_components=3, svd_solver="randomized", random_state=0)
    pca.fit(standardized)
    weights = pca.components_.astype("float32")

    mu_f = mu.astype("float32")
    sigma_f = sigma.astype("float32")
    weights_f = weights.astype("float32")

    Z = (arr - mu_f[:, None, None]) / sigma_f[:, None, None]
    Zc = Z.rechunk({0: -1})
    Wd = da.from_array(weights_f, chunks=weights_f.shape)
    Wc = Wd.rechunk({1: -1})
    pc3 = da.tensordot(Wc, Zc, axes=((1), (0))).astype("float32")
    pc3 = pc3.rechunk((3, "auto", "auto"))

    pc3 = _stabilize_sign(pc3)
    pc3 = _sym_scale(pc3, p=int(os.getenv("EA_PCA_PCTL", "99")))
    pc3 = _apply_mix(pc3, _get_palette_matrix(palette))
    pc3 = _sym_scale(pc3, p=99)

    rgb = _vivid_rgb(
        pc3,
        sat=float(os.getenv("EA_PCA_SAT", "1.5")),
        gamma=float(os.getenv("EA_PCA_GAMMA", "0.9")),
        clahe_clip=float(os.getenv("EA_PCA_CLAHE", "0.006")),
    )
    rgb = da.clip(rgb, 0, 1).astype("float32")
    assert rgb.ndim == 3 and rgb.shape[0] == 3
    return rgb


BASE_THEME_MAP = {
    "true": compose_true_color,
    "false_veg": compose_false_color,
    "ndvi": compose_ndvi,
    "pca": compose_pca,
    "geology": compose_geology,
}


THEME_ALIASES = {
    "truecolor": "true",
    "falseveg": "false_veg",
}


def _ensure_three_channel(arr: np.ndarray) -> np.ndarray:
    arr = np.asarray(arr, dtype="float32")
    if arr.ndim == 2:
        arr = arr[None, ...]
    elif arr.ndim == 3 and arr.shape[0] not in (1, 2, 3) and arr.shape[-1] in (1, 2, 3):
        arr = np.transpose(arr, (2, 0, 1))
    elif arr.ndim != 3:
        raise ValueError(f"Unexpected theme output shape {arr.shape}")
    if arr.shape[0] == 1:
        arr = np.repeat(arr, 3, axis=0)
    elif arr.shape[0] == 2:
        extra = ((arr[0] + arr[1]) / 2)[None, ...]
        arr = np.concatenate([arr, extra], axis=0)
    elif arr.shape[0] > 3:
        LOGGER.warning("Truncating %s-band theme output to 3 bands", arr.shape[0])
        arr = arr[:3]
    return arr.astype("float32")


def build_theme(stack: xr.DataArray, theme: str, request: object | None = None) -> np.ndarray:
    palette = getattr(request, "palette", "vivid") if request else "vivid"
    scheme = getattr(request, "pcaScheme", None) or palette
    pack = getattr(request, "indexPack", "veg") if request else "veg"
    normalized = THEME_ALIASES.get(theme, theme)
    if normalized == "decorr":
        result = compose_decorr(stack, palette=palette)
    elif normalized == "nmf":
        result = compose_nmf(stack, palette=palette)
    elif normalized == "index_triplet":
        result = compose_index_triplet(stack, pack=pack, palette=palette)
    elif normalized == "pca":
        result = compose_pca(stack, palette=scheme)
    else:
        try:
            builder = BASE_THEME_MAP[normalized]
        except KeyError as exc:  # pragma: no cover - defensive
            raise ValueError(f"Unknown theme: {theme}") from exc
        result = builder(stack)
    return _ensure_three_channel(result)
