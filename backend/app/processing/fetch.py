"""Utilities for STAC search and raster loading."""
from __future__ import annotations

import logging
import os
import time
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
from scipy.ndimage import distance_transform_edt, gaussian_filter
import xarray as xr

DEFAULT_STAC_API = os.getenv("STAC_API_URL", "https://earth-search.aws.element84.com/v1")
MOSAIC_MAX_SCENES = max(1, int(os.getenv("MOSAIC_MAX_SCENES", "6")))
MOSAIC_COVERAGE_TARGET = float(os.getenv("MOSAIC_COVERAGE_TARGET", "0.98"))
MOSAIC_MIN_EXTRA_COVERAGE = float(os.getenv("MOSAIC_MIN_EXTRA_COVERAGE", "0.15"))
MOSAIC_NORMALIZE = os.getenv("MOSAIC_NORMALIZE", "true").lower() not in ("0", "false", "no")
# Feather radius (in pixels) used for seam blending when mosaicking scenes
MOSAIC_FEATHER_RADIUS = int(os.getenv("MOSAIC_FEATHER_RADIUS", "96"))
MOSAIC_WEIGHT_MODE = os.getenv("MOSAIC_WEIGHT_MODE", "distance").lower()
MOSAIC_WEIGHT_SMOOTHSTEP = os.getenv("MOSAIC_WEIGHT_SMOOTHSTEP", "true").lower() not in ("0", "false", "no")
MOSAIC_WEIGHT_DOWNSAMPLE = max(1, int(os.getenv("MOSAIC_WEIGHT_DOWNSAMPLE", "4")))
MOSAIC_HARMONIZE = os.getenv("MOSAIC_HARMONIZE", "true").lower() not in ("0", "false", "no")
MOSAIC_HARMONIZE_PLOW = float(os.getenv("MOSAIC_HARMONIZE_PLOW", "10"))
MOSAIC_HARMONIZE_PHIGH = float(os.getenv("MOSAIC_HARMONIZE_PHIGH", "90"))
MOSAIC_HARMONIZE_STRIDE = max(1, int(os.getenv("MOSAIC_HARMONIZE_STRIDE", "6")))
MOSAIC_HARMONIZE_MIN_OVERLAP_PIXELS = int(os.getenv("MOSAIC_HARMONIZE_MIN_OVERLAP_PIXELS", "4000"))
MOSAIC_HARMONIZE_GAIN_MIN = float(os.getenv("MOSAIC_HARMONIZE_GAIN_MIN", "0.6"))
MOSAIC_HARMONIZE_GAIN_MAX = float(os.getenv("MOSAIC_HARMONIZE_GAIN_MAX", "1.7"))
MOSAIC_HARMONIZE_CLAMP_MIN = float(os.getenv("MOSAIC_HARMONIZE_CLAMP_MIN", "0.0"))
MOSAIC_HARMONIZE_CLAMP_MAX = float(os.getenv("MOSAIC_HARMONIZE_CLAMP_MAX", "1.5"))
MOSAIC_HARMONIZE_BRIGHT_CLIP_PCT = float(os.getenv("MOSAIC_HARMONIZE_BRIGHT_CLIP_PCT", "98"))
GEOD = Geod(ellps="WGS84")
WGS84 = "EPSG:4326"
EQUAL_AREA_CRS = "EPSG:6933"
# Prefer a global equal-area transform for coverage calcs to avoid lat/long distortion.
EQUAL_AREA_TRANSFORMER = Transformer.from_crs(WGS84, EQUAL_AREA_CRS, always_xy=True)
# Search windows (days, cloud limit used for single-scene lookups); mosaics score cloud later.
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


def _has_aws_credentials() -> bool:
    if os.getenv("AWS_ACCESS_KEY_ID") and os.getenv("AWS_SECRET_ACCESS_KEY"):
        return True
    if os.getenv("AWS_PROFILE"):
        return True
    credentials_path = os.path.expanduser(os.getenv("AWS_SHARED_CREDENTIALS_FILE", "~/.aws/credentials"))
    if os.path.exists(credentials_path) and os.path.getsize(credentials_path) > 0:
        return True
    config_path = os.path.expanduser(os.getenv("AWS_CONFIG_FILE", "~/.aws/config"))
    if os.path.exists(config_path) and os.path.getsize(config_path) > 0:
        return True
    return False


def _ensure_aws_no_sign() -> None:
    if os.getenv("AWS_NO_SIGN_REQUEST"):
        return
    if _has_aws_credentials():
        return
    os.environ["AWS_NO_SIGN_REQUEST"] = "YES"
    LOGGER.info("AWS_NO_SIGN_REQUEST=YES (no AWS credentials detected)")


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


def _datatake_group_key(item: Item) -> str:
    props = item.properties or {}
    datatake = props.get("sentinel:datatake_start_time") or props.get(
        "s2:datatake_start_time"
    )
    if datatake:
        return str(datatake)
    if item.datetime:
        return item.datetime.date().isoformat()
    raw = props.get("datetime")
    if isinstance(raw, datetime):
        return raw.date().isoformat()
    if isinstance(raw, str):
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00")).date().isoformat()
        except ValueError:
            return raw
    return item.id


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
        raster_bands = info.get("raster:bands")
        if isinstance(raster_bands, list) and raster_bands:
            band_count = len(raster_bands)
        elif isinstance(eo_bands, list) and eo_bands:
            band_count = len(eo_bands)
        else:
            band_count = 1
        gsd = info.get("gsd") or info.get("proj:gsd") or asset.extra_fields.get("proj:resolution")
        available.append(
            {
                "key": key,
                "upper": key.upper(),
                "prefix": key.upper().split("_")[0],
                "common_names": [name.lower() for name in common_names],
                "gsd": gsd,
                "band_count": band_count,
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
        single_band = [asset for asset in candidates if asset["band_count"] == 1]
        if single_band:
            candidates = single_band
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


def _mean_cloud_cover(selections: Sequence[SceneSelection]) -> Optional[float]:
    values = []
    for sel in selections:
        props = sel.item.properties or {}
        raw = props.get("eo:cloud_cover")
        if raw is None:
            continue
        try:
            values.append(float(raw))
        except (TypeError, ValueError):
            continue
    if not values:
        return None
    return float(np.mean(values))


def _normalize_stack(data: da.Array, p_low: float = 2.0, p_high: float = 98.0) -> da.Array:
    sample_np = data[:, ::8, ::8].compute()
    lo = np.nanpercentile(sample_np, p_low, axis=(1, 2), keepdims=True)
    hi = np.nanpercentile(sample_np, p_high, axis=(1, 2), keepdims=True)
    span = np.clip(hi - lo, 1e-6, None)
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
        key = _datatake_group_key(sel.item)
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
                "datetime": max((_item_datetime(sel.item) for sel in group), default=datetime.min),
                "mean_cloud": _mean_cloud_cover(group),
            }
        )

    group_summaries.sort(key=lambda g: g["coverage"], reverse=True)
    limit = min(max_scenes, MOSAIC_MAX_SCENES)
    top_groups = []
    for summary in group_summaries[:3]:
        mean_cloud = summary["mean_cloud"]
        cloud_str = f"{mean_cloud:.1f}" if mean_cloud is not None else "n/a"
        top_groups.append(
            f"{summary['key']} coverage={summary['coverage']:.3f} mean_cloud={cloud_str} "
            f"datetime={summary['datetime'].isoformat()} items={len(summary['items'])}"
        )
    LOGGER.info("Top datatake groups: %s", top_groups)

    def _datetime_sort_value(value: datetime) -> float:
        try:
            return value.timestamp()
        except (OSError, OverflowError, ValueError):
            return 0.0

    def _cloud_sort_value(value: Optional[float]) -> float:
        return value if value is not None else float("inf")

    def _select_group_scenes(group_items: List[SceneSelection]) -> Tuple[List[SceneSelection], float]:
        selected: list[SceneSelection] = []
        covered = None
        for sel in group_items:
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
            if coverage >= MOSAIC_COVERAGE_TARGET:
                break
        return selected, _coverage_fraction(covered, aoi_area)

    def _select_multi_datatake(group_list: List[dict], anchor: dict) -> Tuple[List[SceneSelection], float]:
        anchor_ts = _datetime_sort_value(anchor["datetime"])
        ordered_groups = sorted(
            group_list,
            key=lambda g: abs(_datetime_sort_value(g["datetime"]) - anchor_ts),
        )
        selected: list[SceneSelection] = []
        covered = None
        coverage = 0.0
        for summary in ordered_groups:
            for sel in summary["items"]:
                if len(selected) >= limit:
                    break
                geom = sel.coverage_geom
                if geom is None:
                    selected.append(sel)
                    continue
                if covered is not None:
                    if coverage >= MOSAIC_COVERAGE_TARGET:
                        if sel.coverage is not None and sel.coverage < MOSAIC_MIN_EXTRA_COVERAGE:
                            continue
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
            if coverage >= MOSAIC_COVERAGE_TARGET or len(selected) >= limit:
                break
        return selected, _coverage_fraction(covered, aoi_area)

    coverage_tolerance = 0.02
    eligible = [g for g in group_summaries if g["coverage"] >= MOSAIC_COVERAGE_TARGET]
    candidate_groups = eligible or group_summaries
    top_coverage = candidate_groups[0]["coverage"]
    coverage_candidates = [
        g for g in candidate_groups if top_coverage - g["coverage"] <= coverage_tolerance
    ]
    coverage_candidates.sort(
        key=lambda g: (_cloud_sort_value(g["mean_cloud"]), -_datetime_sort_value(g["datetime"]))
    )
    best = coverage_candidates[0]
    selected, coverage = _select_group_scenes(best["items"])

    if eligible:
        LOGGER.info(
            "Mosaic datatake selection: key=%s mode=single coverage=%.3f",
            best["key"],
            coverage,
        )
        return selected, coverage

    if MOSAIC_HARMONIZE:
        LOGGER.warning(
            "No single datatake covers AOI; falling back to multi-datatake mosaic; seams may occur; harmonization enabled."
        )
    else:
        LOGGER.warning(
            "No single datatake covers AOI; falling back to multi-datatake mosaic; seams may occur; harmonization disabled."
        )
    selected, coverage = _select_multi_datatake(group_summaries, best)
    LOGGER.info(
        "Mosaic datatake selection: mode=fallback-multi base_key=%s coverage=%.3f",
        best["key"],
        coverage,
    )
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
    candidate_limit = max(max_scenes * 2, 200)

    try:
        client = Client.open(stac_api)
    except (pystac_exceptions.APIError, requests_exceptions.RequestException, OSError) as exc:
        msg = (
            f"Unable to reach STAC API {stac_api}: {exc}. "
            "Check your network or set STAC_API_URL to a reachable endpoint (e.g., Planetary Computer)."
        )
        LOGGER.warning(msg)
        raise SceneSearchError(msg) from exc

    for days, _cloud in SEARCH_WINDOWS:
        datetime_filter = date_range or _default_datetime(days)
        search = client.search(
            collections=[collection],
            bbox=aoi_bounds,
            limit=candidate_limit,
            sortby=[{"field": "properties.datetime", "direction": "desc"}],
            datetime=datetime_filter,
            fields={
                "include": [
                    "id",
                    "geometry",
                    "assets",
                    "properties",
                    "properties.eo:cloud_cover",
                    "properties.sentinel:datatake_start_time",
                    "properties.s2:datatake_start_time",
                ]
            },
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
            if len(window_candidates) + len(all_candidates) >= candidate_limit:
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
    _ensure_aws_no_sign()
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
    _ensure_aws_no_sign()

    stacks: list[xr.DataArray] = []
    masks: list[da.Array] = []
    raw_stacks: list[xr.DataArray] = []
    selection_log = []
    scale_logged = False
    stack_start = time.perf_counter()

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
        scales = []
        for asset_id in bands:
            asset = selection.item.assets.get(asset_id)
            raster_meta = (asset.extra_fields or {}).get("raster:bands", [{}]) if asset else [{}]
            scales.append(raster_meta[0].get("scale", 1))
        scale_arr = np.array(scales, dtype="float32")[:, None, None]
        if not scale_logged:
            band_names = list(labels) if labels else list(bands)
            LOGGER.info(
                "Mosaic band scales: %s",
                {name: float(scale) for name, scale in zip(band_names, scales)},
            )
            scale_logged = True
        stack = (stack * scale_arr).astype("float32")
        # Preserve raw (with NaNs) for statistics; construct mask on raw validity
        raw_stacks.append(stack)
        mask = da.isfinite(stack.data).all(axis=0).astype("float32")
        # Defer nan_to_num until after exposure matching to avoid biasing stats
        stacks.append(xr.DataArray(stack.data, dims=stack.dims, coords=stack.coords, attrs=stack.attrs))
        masks.append(mask)
        selection_log.append(
            {
                "id": selection.item.id,
                "datatake": _datatake_key(selection.item),
                "coverage": selection.coverage,
            }
        )

    if not stacks:
        raise SceneValidationError(
            "Selected area does not intersect the Sentinel-2 scenes; try a different date or size."
        )

    stack_elapsed = time.perf_counter() - stack_start
    LOGGER.info("Mosaic stacking completed in %.3fs for %d scenes", stack_elapsed, len(stacks))
    LOGGER.info(
        "Mosaic selections: %s",
        [
            f"{item['id']} datatake={item['datatake']} coverage={item['coverage']:.3f}"
            if item["coverage"] is not None
            else f"{item['id']} datatake={item['datatake']} coverage=None"
            for item in selection_log
        ],
    )

    def _compute_weight_mask(valid_mask: da.Array) -> da.Array:
        radius = max(1, MOSAIC_FEATHER_RADIUS)
        downsample = MOSAIC_WEIGHT_DOWNSAMPLE
        mask_np = valid_mask.astype(bool)[::downsample, ::downsample].compute()
        if mask_np.size == 0:
            return da.zeros(valid_mask.shape, dtype="float32")
        radius_small = max(1.0, radius / float(downsample))
        if MOSAIC_WEIGHT_MODE == "gaussian":
            sigma = max(1.0, radius_small / 3.0)
            w = gaussian_filter(mask_np.astype("float32"), sigma=sigma, mode="nearest")
            max_w = float(np.nanmax(w)) if np.isfinite(w).any() else 1.0
            w = np.clip(w / max(max_w, 1e-6), 0.0, 1.0)
            w = np.where(mask_np, w, 0.0).astype("float32")
        else:
            dist = distance_transform_edt(mask_np)
            w = np.clip(dist / float(radius_small), 0.0, 1.0)
            if MOSAIC_WEIGHT_SMOOTHSTEP:
                w = w * w * (3.0 - 2.0 * w)
            w = np.where(mask_np, w, 0.0).astype("float32")
        if downsample > 1:
            w = np.repeat(np.repeat(w, downsample, axis=0), downsample, axis=1)
            w = w[: valid_mask.shape[0], : valid_mask.shape[1]]
        chunks = getattr(valid_mask, "chunks", None) or valid_mask.shape
        return da.from_array(w, chunks=chunks)

    if MOSAIC_HARMONIZE and len(stacks) > 1:
        harmonize_start = time.perf_counter()
        LOGGER.info(
            "Mosaic harmonization enabled plow=%.1f phigh=%.1f stride=%d min_overlap=%d gain_clip=[%.3f, %.3f] clamp=[%.2f, %.2f] bright_clip_pct=%.1f",
            MOSAIC_HARMONIZE_PLOW,
            MOSAIC_HARMONIZE_PHIGH,
            MOSAIC_HARMONIZE_STRIDE,
            MOSAIC_HARMONIZE_MIN_OVERLAP_PIXELS,
            MOSAIC_HARMONIZE_GAIN_MIN,
            MOSAIC_HARMONIZE_GAIN_MAX,
            MOSAIC_HARMONIZE_CLAMP_MIN,
            MOSAIC_HARMONIZE_CLAMP_MAX,
            MOSAIC_HARMONIZE_BRIGHT_CLIP_PCT,
        )
        ref_data = raw_stacks[0].data
        for idx in range(1, len(stacks)):
            scene_id = selection_log[idx]["id"]
            scene_data = raw_stacks[idx].data
            stride = MOSAIC_HARMONIZE_STRIDE
            sample_ref = ref_data[:, ::stride, ::stride]
            sample_scene = scene_data[:, ::stride, ::stride]
            valid_ref = da.isfinite(sample_ref).all(axis=0) & da.all(sample_ref > 0, axis=0)
            valid_scene = da.isfinite(sample_scene).all(axis=0) & da.all(sample_scene > 0, axis=0)
            overlap_mask = valid_ref & valid_scene
            ref_np, scene_np, mask_np = da.compute(sample_ref, sample_scene, overlap_mask)
            mask_np = np.asarray(mask_np, dtype=bool)
            overlap_pixels = int(mask_np.sum())
            if overlap_pixels < MOSAIC_HARMONIZE_MIN_OVERLAP_PIXELS:
                LOGGER.info(
                    "Mosaic harmonize scene=%s skipped (overlap=%d < min=%d)",
                    scene_id,
                    overlap_pixels,
                    MOSAIC_HARMONIZE_MIN_OVERLAP_PIXELS,
                )
                continue
            bright_clip_pct = MOSAIC_HARMONIZE_BRIGHT_CLIP_PCT
            if bright_clip_pct and ref_np.shape[0] >= 3:
                brightness = np.nanmean(np.where(mask_np, ref_np[:3], np.nan), axis=0)
                if np.isfinite(brightness).any():
                    bright_thresh = np.nanpercentile(brightness, bright_clip_pct)
                    if np.isfinite(bright_thresh):
                        bright_mask = brightness <= bright_thresh
                        mask_np = mask_np & bright_mask
                        overlap_pixels = int(mask_np.sum())
                        if overlap_pixels < MOSAIC_HARMONIZE_MIN_OVERLAP_PIXELS:
                            LOGGER.info(
                                "Mosaic harmonize scene=%s skipped after bright clip (overlap=%d < min=%d)",
                                scene_id,
                                overlap_pixels,
                                MOSAIC_HARMONIZE_MIN_OVERLAP_PIXELS,
                            )
                            continue
            masked_ref = np.where(mask_np, ref_np, np.nan)
            masked_scene = np.where(mask_np, scene_np, np.nan)
            ref_percentiles = np.nanpercentile(
                masked_ref, [MOSAIC_HARMONIZE_PLOW, MOSAIC_HARMONIZE_PHIGH], axis=(1, 2)
            )
            scene_percentiles = np.nanpercentile(
                masked_scene, [MOSAIC_HARMONIZE_PLOW, MOSAIC_HARMONIZE_PHIGH], axis=(1, 2)
            )
            ref_lo, ref_hi = ref_percentiles
            scene_lo, scene_hi = scene_percentiles
            span_scene = np.clip(scene_hi - scene_lo, 1e-6, None)
            gain = (ref_hi - ref_lo) / span_scene
            offset = ref_lo - gain * scene_lo
            gain = np.clip(np.where(np.isfinite(gain), gain, 1.0), MOSAIC_HARMONIZE_GAIN_MIN, MOSAIC_HARMONIZE_GAIN_MAX)
            offset = np.where(np.isfinite(offset), offset, 0.0)
            LOGGER.info(
                "Mosaic harmonize scene=%s overlap=%d gains=%s offsets=%s",
                scene_id,
                overlap_pixels,
                np.round(gain, 4).tolist(),
                np.round(offset, 4).tolist(),
            )
            corrected = stacks[idx] * gain[:, None, None] + offset[:, None, None]
            corrected = corrected.clip(MOSAIC_HARMONIZE_CLAMP_MIN, MOSAIC_HARMONIZE_CLAMP_MAX)
            stacks[idx] = corrected
            raw_stacks[idx] = corrected
        LOGGER.info("Mosaic harmonization completed in %.3fs", time.perf_counter() - harmonize_start)
    elif not MOSAIC_HARMONIZE:
        LOGGER.info("Mosaic harmonization disabled by config")

    weight_start = time.perf_counter()
    weights = [_compute_weight_mask(mask) for mask in masks]
    weight = da.stack(weights, axis=0)
    data = da.stack([arr.data for arr in stacks], axis=0)  # scene, band, y, x
    LOGGER.info("Mosaic weight mask generation completed in %.3fs", time.perf_counter() - weight_start)

    LOGGER.info(
        "Mosaic weight mode=%s radius=%d smoothstep=%s downsample=%d",
        MOSAIC_WEIGHT_MODE,
        MOSAIC_FEATHER_RADIUS,
        MOSAIC_WEIGHT_SMOOTHSTEP,
        MOSAIC_WEIGHT_DOWNSAMPLE,
    )
    blend_start = time.perf_counter()
    weighted_sum = da.nansum(data * weight[:, None, :, :], axis=0)
    weight_sum = weight.sum(axis=0)
    mosaic = da.where(weight_sum > 1e-6, weighted_sum / weight_sum, np.nan).astype("float32")
    LOGGER.info("Mosaic blend graph assembled in %.3fs", time.perf_counter() - blend_start)

    if MOSAIC_NORMALIZE:
        # Normalize once on the final mosaic to avoid seam artifacts from per-scene adjustments.
        normalize_start = time.perf_counter()
        mosaic = _normalize_stack(mosaic)
        LOGGER.info("Mosaic normalization completed in %.3fs", time.perf_counter() - normalize_start)

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
