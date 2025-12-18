"""Utilities for STAC search and raster loading."""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import List, Sequence, Tuple, Optional

import dask.array as da
import numpy as np
from pystac import Item
from pystac_client import Client, exceptions as pystac_exceptions
from requests import exceptions as requests_exceptions
from pyproj import Geod, Transformer
from rasterio.enums import Resampling
from shapely.geometry import Polygon, box, shape
from shapely.ops import transform as shapely_transform, unary_union
import stackstac
from scipy.ndimage import uniform_filter
import xarray as xr

DEFAULT_STAC_API = os.getenv("STAC_API_URL", "https://earth-search.aws.element84.com/v1")
MOSAIC_MAX_SCENES = max(1, int(os.getenv("MOSAIC_MAX_SCENES", "6")))
MOSAIC_COVERAGE_TARGET = float(os.getenv("MOSAIC_COVERAGE_TARGET", "0.98"))
MOSAIC_MIN_EXTRA_COVERAGE = float(os.getenv("MOSAIC_MIN_EXTRA_COVERAGE", "0.15"))
MOSAIC_NORMALIZE = os.getenv("MOSAIC_NORMALIZE", "true").lower() not in ("0", "false", "no")
GEOD = Geod(ellps="WGS84")
WGS84 = "EPSG:4326"
EQUAL_AREA_CRS = "EPSG:6933"
# Prefer a global equal-area transform for coverage calcs to avoid lat/long distortion.
EQUAL_AREA_TRANSFORMER = Transformer.from_crs(WGS84, EQUAL_AREA_CRS, always_xy=True)
# Prefer clearer scenes: tightened cloud limits over both windows
SEARCH_WINDOWS = ((90, 5), (365, 20))
LOGGER = logging.getLogger(__name__)
ALIAS_COMMON_NAME = {
    "B02": ["blue"],
    "B03": ["green"],
    "B04": ["red"],
    "B08": ["nir"],
    "B11": ["swir16"],
    "B12": ["swir22"],
}


class SceneSearchError(Exception):
    """Raised when the STAC endpoint cannot be reached."""


class SceneNotFoundError(Exception):
    """Raised when no Sentinel-2 scenes match the AOI/date filters."""


class SceneValidationError(Exception):
    """Raised when the selected scene cannot be used for the AOI."""


@dataclass
class SceneSelection:
    item: Item
    bbox: Tuple[float, float, float, float]
    x_coords: Optional[np.ndarray] = None
    y_coords: Optional[np.ndarray] = None
    width: Optional[int] = None
    height: Optional[int] = None
    crs: Optional[str] = None
    mosaic_ids: Optional[List[str]] = None
    coverage: Optional[float] = None
    coverage_geom: Optional[object] = None


def bbox_from_center(lat: float, lon: float, size_km: float) -> Tuple[float, float, float, float]:
    """Build a lon/lat bbox centered on the point with the given size."""
    half = size_km * 1000 / 2
    lon_w, _, _ = GEOD.fwd(lon, lat, 270, half)
    lon_e, _, _ = GEOD.fwd(lon, lat, 90, half)
    _, lat_n, _ = GEOD.fwd(lon, lat, 0, half)
    _, lat_s, _ = GEOD.fwd(lon, lat, 180, half)
    min_lon, max_lon = sorted([lon_w, lon_e])
    min_lat, max_lat = sorted([lat_s, lat_n])
    return (min_lon, min_lat, max_lon, max_lat)


def determine_utm_epsg(lat: float, lon: float) -> int:
    zone = int((lon + 180) / 6) + 1
    return 32600 + zone if lat >= 0 else 32700 + zone


def _project_equal_area(geom: Polygon):
    try:
        return shapely_transform(EQUAL_AREA_TRANSFORMER.transform, geom)
    except Exception:
        return geom


def project_bounds(bbox: Tuple[float, float, float, float], epsg_code: int) -> Tuple[float, float, float, float]:
    poly: Polygon = box(*bbox)
    transformer = Transformer.from_crs(WGS84, f"EPSG:{epsg_code}", always_xy=True)
    projected = shapely_transform(transformer.transform, poly)
    return projected.bounds


def resolution_from_bounds(bounds: Tuple[float, float, float, float], target_pixels: int) -> float:
    width = bounds[2] - bounds[0]
    height = bounds[3] - bounds[1]
    max_side = max(abs(width), abs(height))
    pixels = max(target_pixels, 64)
    value = max_side / pixels
    return value if value > 0 else 10.0


def _default_datetime(days: int) -> str:
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=days)
    return f"{start.isoformat()}/{end.isoformat()}"


def _ensure_intersection(item: Item, bbox: Tuple[float, float, float, float]) -> None:
    if not item.geometry:
        return
    scene_geom = shape(item.geometry)
    if not scene_geom.is_valid:
        scene_geom = scene_geom.buffer(0)
    aoi = box(*bbox)
    if not scene_geom.intersects(aoi):
        raise SceneValidationError(
            "Selected area does not intersect scene footprint; try a different date or a larger size."
        )


def _datatake_key(item: Item) -> str:
    props = item.properties or {}
    datatake = props.get("sentinel:datatake_start_time") or props.get(
        "s2:datatake_start_time"
    )
    if datatake:
        return str(datatake)
    if item.datetime:
        return item.datetime.isoformat()
    return props.get("datetime", item.id)


def _item_datetime(item: Item) -> datetime:
    props = item.properties or {}
    raw = props.get("datetime")
    if isinstance(raw, datetime):
        return raw
    if isinstance(raw, str):
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return datetime.min
    if item.datetime:
        return item.datetime
    return datetime.min


def _resolve_assets(item: Item, requested: Sequence[str], prefer_gsd: int = 10) -> Tuple[List[str], List[str]]:
    available = []
    for key, asset in item.assets.items():
        info = asset.extra_fields or {}
        common_names = []
        eo_bands = info.get("eo:bands")
        if eo_bands:
            for band in eo_bands:
                if "common_name" in band:
                    common_names.append(band["common_name"])
        gsd = info.get("gsd") or info.get("proj:gsd") or asset.extra_fields.get("proj:resolution")
        available.append(
            {
                "key": key,
                "upper": key.upper(),
                "prefix": key.upper().split("_")[0],
                "common_names": [name.lower() for name in common_names],
                "gsd": gsd,
            }
        )

    resolved: List[str] = []
    labels: List[str] = []
    missing: List[str] = []
    for band in requested:
        desired_upper = band.upper()
        candidates = [asset for asset in available if asset["upper"] == desired_upper]
        if not candidates:
            candidates = [asset for asset in available if asset["prefix"] == desired_upper]
        if not candidates:
            cn = ALIAS_COMMON_NAME.get(band, [])
            candidates = [
                asset
                for asset in available
                if any(name in asset["common_names"] for name in cn)
            ]
        if not candidates:
            missing.append(band)
            continue
        candidates.sort(
            key=lambda asset: (
                abs((asset["gsd"] or prefer_gsd) - prefer_gsd),
                asset["gsd"] or prefer_gsd,
            )
        )
        resolved.append(candidates[0]["key"])
        labels.append(band)

    if missing:
        raise SceneValidationError(
            "Scene {} is missing required bands: {} (checked Bxx variants and eo:bands common_name)".format(
                item.id, ", ".join(missing)
            )
        )
    return resolved, labels


def _intersect_scene(item: Item, aoi: Polygon):
    if not item.geometry:
        return None
    geom = shape(item.geometry)
    if not geom.is_valid:
        geom = geom.buffer(0)
    if not geom.intersects(aoi):
        return None
    intersection = geom.intersection(aoi)
    if intersection.is_empty:
        return None
    projected = _project_equal_area(intersection)
    if projected.is_empty:
        return None
    return projected


def _coverage_fraction(geom, aoi_area: float) -> float:
    if geom is None or aoi_area <= 0:
        return 0.0
    try:
        return float(geom.area / aoi_area)
    except Exception:
        return 0.0


def _group_coverage(selections: List[SceneSelection], aoi_area: float) -> Tuple[float, object | None]:
    geoms = [sel.coverage_geom for sel in selections if sel.coverage_geom is not None]
    if not geoms:
        return 0.0, None
    try:
        unioned = unary_union(geoms)
    except Exception:
        unioned = geoms[0]
        for geom in geoms[1:]:
            try:
                unioned = unioned.union(geom)
            except Exception:
                continue
    return _coverage_fraction(unioned, aoi_area), unioned


def _normalize_stack(data: da.Array, p_low: float = 2.0, p_high: float = 98.0) -> da.Array:
    sample = data[:, ::8, ::8]
    lo = da.nanpercentile(sample, p_low, axis=(1, 2), keepdims=True)
    hi = da.nanpercentile(sample, p_high, axis=(1, 2), keepdims=True)
    span = da.clip(hi - lo, 1e-6, None)
    return da.clip((data - lo) / span, 0, 1).astype("float32")


def _select_scenes_for_coverage(
    selections: List[SceneSelection],
    aoi_area: float,
    max_scenes: int,
) -> Tuple[List[SceneSelection], float]:
    if not selections:
        return [], 0.0

    groups: dict[str, List[SceneSelection]] = {}
    for sel in selections:
        key = _datatake_key(sel.item)
        groups.setdefault(key, []).append(sel)

    group_summaries = []
    for key, group in groups.items():
        coverage, union_geom = _group_coverage(group, aoi_area)
        # Sort per-group by footprint contribution so we pick the largest tiles first.
        sorted_group = sorted(group, key=lambda s: s.coverage or 0.0, reverse=True)
        group_summaries.append(
            {
                "key": key,
                "coverage": coverage,
                "union": union_geom,
                "items": sorted_group,
                "datetime": _item_datetime(group[0].item),
            }
        )

    group_summaries.sort(key=lambda g: (g["coverage"], len(g["items"]), g["datetime"]), reverse=True)
    limit = min(max_scenes, MOSAIC_MAX_SCENES)

    # If every datatake only has a single scene, mix across datatakes up to the cap
    # to mimic the prior behavior and avoid over-relying on one sliver.
    if len(group_summaries) > 1 and max(len(g["items"]) for g in group_summaries) == 1:
        selected: list[SceneSelection] = []
        covered = None
        for summary in group_summaries:
            if len(selected) >= limit:
                break
            sel = summary["items"][0]
            if covered is not None and _coverage_fraction(covered, aoi_area) >= MOSAIC_COVERAGE_TARGET:
                if sel.coverage is not None and sel.coverage < MOSAIC_MIN_EXTRA_COVERAGE:
                    continue
            selected.append(sel)
            geom = sel.coverage_geom
            if geom is None:
                continue
            if covered is None:
                covered = geom
            else:
                try:
                    covered = covered.union(geom)
                except Exception:
                    covered = unary_union([covered, geom])
        coverage = _coverage_fraction(covered, aoi_area)
        return selected, coverage

    best = group_summaries[0]
    selected: list[SceneSelection] = []
    covered = None
    for sel in best["items"]:
        if len(selected) >= limit:
            break
        selected.append(sel)
        geom = sel.coverage_geom
        if geom is None:
            continue
        if covered is None:
            covered = geom
        else:
            try:
                covered = covered.union(geom)
            except Exception:
                covered = unary_union([covered, geom])
    coverage = _coverage_fraction(covered, aoi_area)
    if coverage >= MOSAIC_COVERAGE_TARGET or len(group_summaries) == 1 or len(selected) >= limit:
        return selected, coverage

    extras: list[SceneSelection] = []
    for summary in group_summaries[1:]:
        extras.extend(summary["items"])
    extras.sort(key=lambda s: (s.coverage or 0.0, _item_datetime(s.item)), reverse=True)

    for sel in extras:
        if len(selected) >= limit:
            break
        geom = sel.coverage_geom
        if geom is None:
            selected.append(sel)
            continue
        if covered is not None:
            try:
                incremental = geom.difference(covered)
            except Exception:
                incremental = geom
            if incremental.is_empty or _coverage_fraction(incremental, aoi_area) < 0.005:
                continue
            try:
                covered = covered.union(geom)
            except Exception:
                covered = unary_union([covered, geom])
        else:
            covered = geom
        selected.append(sel)
        coverage = _coverage_fraction(covered, aoi_area)
        if coverage >= MOSAIC_COVERAGE_TARGET:
            break

    coverage = _coverage_fraction(covered, aoi_area)
    return selected, coverage


def find_scene(
    lat: float,
    lon: float,
    size_km: float,
    date_range: str | None = None,
    stac_api: str = DEFAULT_STAC_API,
    aoi_bounds: Tuple[float, float, float, float] | None = None,
) -> SceneSelection:
    bbox = aoi_bounds or bbox_from_center(lat, lon, size_km)
    try:
        client = Client.open(stac_api)
    except (pystac_exceptions.APIError, requests_exceptions.RequestException, OSError) as exc:
        msg = (
            f"Unable to reach STAC API {stac_api}: {exc}. "
            "Check your network or set STAC_API_URL to a reachable endpoint (e.g., Planetary Computer)."
        )
        LOGGER.warning(msg)
        raise SceneSearchError(msg) from exc

    for days, cloud in SEARCH_WINDOWS:
        datetime_filter = date_range or _default_datetime(days)
        search = client.search(
            collections=["sentinel-2-l2a"],
            bbox=bbox,
            limit=20,
            sortby=[{"field": "properties.datetime", "direction": "desc"}],
            query={"eo:cloud_cover": {"lt": cloud}},
            datetime=datetime_filter,
        )
        items = list(search.items())
        if items:
            return SceneSelection(item=items[0], bbox=bbox)

    raise SceneNotFoundError(
        "No recent Sentinel-2 L2A scenes found for this AOI/date window."
    )


def find_scenes_for_aoi(
    aoi_bounds: Tuple[float, float, float, float],
    product: str = "sentinel-2",
    max_scenes: int = 6,
    date_range: str | None = None,
    stac_api: str = DEFAULT_STAC_API,
) -> List[SceneSelection]:
    collection = "sentinel-2-l2a" if product == "sentinel-2" else product
    aoi = box(*aoi_bounds)
    aoi_equal_area = _project_equal_area(aoi)
    aoi_area = max(aoi_equal_area.area, 1e-6)
    all_candidates: list[SceneSelection] = []
    best: list[SceneSelection] = []
    best_coverage = 0.0
    seen_ids: set[str] = set()

    try:
        client = Client.open(stac_api)
    except (pystac_exceptions.APIError, requests_exceptions.RequestException, OSError) as exc:
        msg = (
            f"Unable to reach STAC API {stac_api}: {exc}. "
            "Check your network or set STAC_API_URL to a reachable endpoint (e.g., Planetary Computer)."
        )
        LOGGER.warning(msg)
        raise SceneSearchError(msg) from exc

    for days, cloud in SEARCH_WINDOWS:
        datetime_filter = date_range or _default_datetime(days)
        search = client.search(
            collections=[collection],
            bbox=aoi_bounds,
            limit=max_scenes * 2,
            sortby=[{"field": "properties.datetime", "direction": "desc"}],
            query={"eo:cloud_cover": {"lt": cloud}},
            datetime=datetime_filter,
        )
        window_candidates: list[SceneSelection] = []
        for item in search.items():
            if item.id in seen_ids:
                continue
            intersection = _intersect_scene(item, aoi)
            if intersection is None:
                continue
            coverage = _coverage_fraction(intersection, aoi_area)
            selection = SceneSelection(
                item=item,
                bbox=aoi_bounds,
                coverage=coverage,
                coverage_geom=intersection,
            )
            window_candidates.append(selection)
            seen_ids.add(item.id)
            if len(window_candidates) + len(all_candidates) >= max_scenes * 2:
                break

        if not window_candidates and not all_candidates:
            continue

        all_candidates.extend(window_candidates)
        selections, coverage = _select_scenes_for_coverage(all_candidates, aoi_area, max_scenes)
        if coverage > best_coverage:
            best = selections
            best_coverage = coverage
        if coverage >= MOSAIC_COVERAGE_TARGET:
            return selections

    if best:
        return best
    raise SceneNotFoundError(
        "No recent Sentinel-2 L2A scenes found for this AOI/date window."
    )


def required_bands(theme: str) -> List[str]:
    mapping = {
        "true": ["B04", "B03", "B02"],
        "truecolor": ["B04", "B03", "B02"],
        "false_veg": ["B08", "B04", "B03"],
        "falseveg": ["B08", "B04", "B03"],
        "ndvi": ["B08", "B04"],
        "pca": ["B02", "B03", "B04", "B08", "B11", "B12"],
        "decorr": ["B12", "B08", "B04"],
        "nmf": ["B02", "B03", "B04", "B08", "B11", "B12"],
        "index_triplet": ["B02", "B03", "B04", "B08", "B11", "B12"],
        "geology": ["B12", "B11", "B04"],
    }
    return mapping[theme]


def load_scene_stack(
    item: Item,
    bbox4326: Tuple[float, float, float, float],
    assets: Sequence[str],
    target_pixels: int,
    labels: Sequence[str],
    resampling: Resampling,
) -> Tuple[xr.DataArray, int]:
    center_lat = (bbox4326[1] + bbox4326[3]) / 2
    center_lon = (bbox4326[0] + bbox4326[2]) / 2
    epsg_code = determine_utm_epsg(center_lat, center_lon)
    utm_bounds = project_bounds(bbox4326, epsg_code)
    resolution = resolution_from_bounds(utm_bounds, target_pixels)
    _ensure_intersection(item, bbox4326)

    def _stack(selected: Resampling):
        return stackstac.stack(
            [item],
            assets=list(assets),
            bounds=utm_bounds,
            epsg=epsg_code,
            resolution=resolution,
            resampling=selected,
            chunksize=2048,
            rescale=False,
            fill_value=np.nan,
        )

    try:
        stack = _stack(resampling)
    except (AssertionError, ValueError) as exc:
        LOGGER.warning("Resampling '%s' failed (%s); retrying with nearest", resampling, exc)
        try:
            stack = _stack(Resampling.nearest)
        except Exception as retry_exc:  # pragma: no cover - defensive
            raise SceneValidationError(
                "Unable to build raster stack (CRS/bounds mismatch)."
            ) from retry_exc

    if stack.sizes.get("time", 0) == 0:
        raise SceneValidationError(
            "Selected area does not intersect the Sentinel-2 scene; try a different date or size."
        )

    if "band" not in stack.dims and "assets" in stack.dims:
        stack = stack.rename({"assets": "band"})

    stack = stack.isel(time=0).transpose("band", "y", "x").astype("float32")
    if labels:
        stack = stack.assign_coords(band=list(labels))

    scales = []
    for asset_id in assets:
        asset = item.assets.get(asset_id)
        raster_meta = (asset.extra_fields or {}).get("raster:bands", [{}])
        scales.append(raster_meta[0].get("scale", 1))
    scale_arr = np.array(scales, dtype="float32")[:, None, None]
    return stack * scale_arr, epsg_code


def build_mosaic_stack(
    selections: List[SceneSelection],
    aoi_bounds: Tuple[float, float, float, float],
    bands: Sequence[str],
    target_resolution: float,
    resampling: Resampling,
    *,
    labels: Sequence[str] | None = None,
    utm_bounds: Tuple[float, float, float, float] | None = None,
    epsg_code: int | None = None,
) -> xr.DataArray:
    if not selections:
        raise SceneValidationError("No scenes provided for mosaic")

    center_lat = (aoi_bounds[1] + aoi_bounds[3]) / 2
    center_lon = (aoi_bounds[0] + aoi_bounds[2]) / 2
    epsg_code = epsg_code or determine_utm_epsg(center_lat, center_lon)
    utm_bounds = utm_bounds or project_bounds(aoi_bounds, epsg_code)

    stacks: list[xr.DataArray] = []
    masks: list[da.Array] = []

    def _stack(selection: SceneSelection):
        return stackstac.stack(
            [selection.item],
            assets=list(bands),
            bounds=utm_bounds,
            epsg=epsg_code,
            resolution=target_resolution,
            resampling=resampling,
            chunksize=2048,
            rescale=False,
            fill_value=np.nan,
        )

    for selection in selections:
        try:
            _ensure_intersection(selection.item, aoi_bounds)
        except SceneValidationError:
            continue
        stack = _stack(selection)
        if stack.sizes.get("time", 0) == 0:
            continue
        if "band" not in stack.dims and "assets" in stack.dims:
            stack = stack.rename({"assets": "band"})
        stack = stack.isel(time=0).transpose("band", "y", "x").astype("float32")
        if labels:
            stack = stack.assign_coords(band=list(labels))
        mask = da.isfinite(stack.data).all(axis=0).astype("float32")
        data = da.map_blocks(np.nan_to_num, stack.data, dtype=stack.data.dtype)
        stacks.append(xr.DataArray(data, dims=stack.dims, coords=stack.coords, attrs=stack.attrs))
        masks.append(mask)

    if not stacks:
        raise SceneValidationError(
            "Selected area does not intersect the Sentinel-2 scenes; try a different date or size."
        )

    data = da.stack([arr.data for arr in stacks], axis=0)  # scene, band, y, x
    weight = da.stack(masks, axis=0)

    if MOSAIC_NORMALIZE:
        sample = data[:, :, ::8, ::8]
        lo = da.nanpercentile(sample, 2.0, axis=(0, 2, 3), keepdims=True)
        hi = da.nanpercentile(sample, 98.0, axis=(0, 2, 3), keepdims=True)
        span = da.clip(hi - lo, 1e-6, None)
        data = da.clip((data - lo) / span, 0, 1).astype("float32")

    def _feather_mask(mask_arr: da.Array, radius: int = 6) -> da.Array:
        size = max(1, int(radius))
        return da.map_overlap(
            lambda block: uniform_filter(block, size=size, mode="nearest"),
            mask_arr.astype("float32"),
            depth=size,
            boundary="nearest",
            dtype="float32",
        )

    feathered = _feather_mask(weight)
    weighted_sum = (data * feathered[:, None, :, :]).sum(axis=0)
    weight_sum = feathered.sum(axis=0)
    mosaic = da.where(weight_sum > 1e-6, weighted_sum / weight_sum, np.nan).astype("float32")
    combined = xr.DataArray(
        data,
        dims=("scene", "band", "y", "x"),
        coords={"scene": np.arange(data.shape[0]), "band": stacks[0].coords["band"], "y": stacks[0].coords["y"], "x": stacks[0].coords["x"]},
        attrs=stacks[0].attrs,
    )
    return xr.DataArray(
        mosaic,
        dims=("band", "y", "x"),
        coords={"band": combined.band, "y": combined.y, "x": combined.x},
        attrs=combined.attrs,
    )


def fetch_raster_stack(
    lat: float,
    lon: float,
    size_km: float,
    theme: str,
    target_pixels: int,
    date_range: str | None = None,
    aoi_bounds: Tuple[float, float, float, float] | None = None,
) -> Tuple[xr.DataArray, SceneSelection, str]:
    bbox4326 = aoi_bounds or bbox_from_center(lat, lon, size_km)
    selections = find_scenes_for_aoi(bbox4326, date_range=date_range)
    canonical_bands = required_bands(theme)
    asset_ids, labels = _resolve_assets(selections[0].item, canonical_bands)
    resampling = get_resampling(os.getenv("RASTER_RESAMPLING", "bilinear"))
    center_lat = (bbox4326[1] + bbox4326[3]) / 2
    center_lon = (bbox4326[0] + bbox4326[2]) / 2
    epsg_code = determine_utm_epsg(center_lat, center_lon)
    utm_bounds = project_bounds(bbox4326, epsg_code)
    resolution = resolution_from_bounds(utm_bounds, target_pixels)

    if len(selections) == 1:
        selection = selections[0]
        stack, epsg_code = load_scene_stack(
            selection.item, selection.bbox, asset_ids, target_pixels, labels, resampling
        )
    else:
        stack = build_mosaic_stack(
            selections,
            bbox4326,
            asset_ids,
            resolution,
            resampling,
            labels=labels,
            utm_bounds=utm_bounds,
            epsg_code=epsg_code,
        )
        selection = selections[0]
        selection.mosaic_ids = [sel.item.id for sel in selections]

    selection.x_coords = np.asarray(stack.x.values)
    selection.y_coords = np.asarray(stack.y.values)
    selection.width = int(stack.sizes.get("x", stack.shape[-1]))
    selection.height = int(stack.sizes.get("y", stack.shape[-2]))
    selection.crs = f"EPSG:{epsg_code}"
    return stack, selection, selection.crs
def get_resampling(name: str | None) -> Resampling:
    table = {
        "nearest": Resampling.nearest,
        "bilinear": Resampling.bilinear,
        "cubic": Resampling.cubic,
        "lanczos": Resampling.lanczos,
        "average": Resampling.average,
        "mode": Resampling.mode,
    }
    if not name:
        return Resampling.bilinear
    return table.get(name.lower(), Resampling.bilinear)
