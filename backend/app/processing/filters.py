from __future__ import annotations

import numpy as np
import dask.array as da
import xarray as xr

from app.models import FilterSpec, OverlayOptions, OverlayStyle, OverlayStyles
from app.processing import compose, overlays, render
from app.processing.fetch import SceneSelection


def _select(stack: xr.DataArray, bands: list[str]) -> xr.DataArray:
    return stack.sel(band=list(bands))


def _stretch_and_gamma(data, gamma: float = 1.0, lower: float = 2.0, upper: float = 98.0) -> np.ndarray:
    stretched = render.apply_percentile_stretch(data, lower=lower, upper=upper)
    if gamma != 1.0:
        stretched = render.apply_gamma(stretched, gamma)
    return np.clip(stretched, 0, 1)


def _desert_veins(stack: xr.DataArray) -> np.ndarray:
    bands = compose._bands_dict(stack)  # type: ignore[attr-defined]
    b8 = bands.get("B08")
    b4 = bands.get("B04")
    b11 = bands.get("B11")
    b12 = bands.get("B12")
    if b8 is None or b4 is None or b11 is None or b12 is None:
        return np.zeros((3, stack.sizes.get("y", 0), stack.sizes.get("x", 0)), dtype="float32")
    ndvi = (b8 - b4) / (b8 + b4 + 1e-6)
    cube = da.stack([b11, b12, ndvi], axis=0).astype("float32")
    return _stretch_and_gamma(cube, gamma=0.95, lower=2, upper=98)


def _false_color(stack: xr.DataArray, bands: list[str], gamma: float = 1.0) -> np.ndarray:
    data = _select(stack, bands)
    return _stretch_and_gamma(data, gamma=gamma)


def _apply_osm_overlay(
    base_image,
    selection: SceneSelection,
    roads_cfg: dict | None,
    buildings_cfg: dict | None,
):
    roads_enabled = bool(roads_cfg and roads_cfg.get("enabled", True))
    bld_enabled = bool(buildings_cfg and buildings_cfg.get("enabled", False))
    overlays_opt = OverlayOptions(roads=roads_enabled, buildings=bld_enabled)
    if not overlays_opt.any_enabled():
        return base_image
    feats = overlays.fetch_osm_features(selection.bbox, overlays_opt)
    road_style = None
    bld_style = None
    if roads_cfg:
        road_style = OverlayStyle(
            color=roads_cfg.get("color"),
            width=roads_cfg.get("width"),
            opacity=roads_cfg.get("opacity"),
        )
    if buildings_cfg:
        bld_style = OverlayStyle(
            color=buildings_cfg.get("color"),
            width=buildings_cfg.get("width"),
            opacity=buildings_cfg.get("opacity"),
            fill_opacity=buildings_cfg.get("fill_opacity"),
        )
    styles = OverlayStyles(roads=road_style, buildings=bld_style)
    return overlays.draw_vectors(
        base_image,
        selection,
        feats,
        want_roads=overlays_opt.roads,
        want_buildings=overlays_opt.buildings,
        styles=styles,
    )


def render_filter(
    stack: xr.DataArray,
    selection: SceneSelection,
    spec: FilterSpec,
    *,
    preview_mode: bool = False,
) -> np.ndarray:
    params = spec.params or {}
    style = spec.styleType
    if style == "PCA":
        palette = str(params.get("stretch") or params.get("palette") or "vivid")
        return compose.compose_pca(stack, palette=palette)
    if style == "MNF":
        return compose.compose_nmf(stack, palette=str(params.get("palette", "vivid")))
    if style == "FalseColor":
        bands = params.get("rgbBands") or params.get("inputBands") or ["B08", "B04", "B03"]
        gamma = float(params.get("gamma", 1.0))
        return _false_color(stack, list(bands), gamma=gamma)
    if style == "DecorrelatedStretch":
        bands = params.get("inputBands") or ["B12", "B08", "B04"]
        palette = str(params.get("palette", "vivid"))
        return compose.compose_decorr(stack, palette=palette, triplet=tuple(bands))
    if style == "Custom":
        return _desert_veins(stack)
    if style == "UrbanOverlay":
        base_cfg = params.get("base", {}) if isinstance(params, dict) else {}
        base_type = base_cfg.get("type", "solid")
        brightness = float(base_cfg.get("brightness", 0.7))
        if base_type == "solid":
            height = selection.height or int(stack.sizes.get("y", stack.shape[-2]))
            width = selection.width or int(stack.sizes.get("x", stack.shape[-1]))
            base_color = base_cfg.get("color", "#0b1020")
            base = render.make_solid_canvas(height, width, base_color)
            base = np.clip(base * brightness, 0, 1)
        else:
            bands = base_cfg.get("rgbBands", ["B04", "B03", "B02"])
            gamma = float(base_cfg.get("gamma", 1.0))
            base = _false_color(stack, list(bands), gamma=gamma)
            base = np.clip(base * brightness, 0, 1)
        saturation = float(base_cfg.get("saturation", 0.35))
        if saturation != 1.0:
            # basic desaturation in HSV
            import skimage.color

            rgb = np.transpose(base, (1, 2, 0))
            hsv = skimage.color.rgb2hsv(rgb)
            hsv[..., 1] = np.clip(hsv[..., 1] * saturation, 0, 1)
            rgb = skimage.color.hsv2rgb(hsv)
            base = np.transpose(rgb.astype("float32"), (2, 0, 1))
        pil_img = render.to_image(base, gamma=1.0, apply_stretch=False)
        pil_img = _apply_osm_overlay(
            pil_img,
            selection,
            params.get("roads") if isinstance(params, dict) else None,
            params.get("buildings") if isinstance(params, dict) else None,
        )
        return np.transpose(np.asarray(pil_img).astype("float32") / 255.0, (2, 0, 1))
    # fallback to zeros
    return np.zeros((3, stack.sizes.get("y", 0), stack.sizes.get("x", 0)), dtype="float32")
