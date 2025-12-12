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
from shapely.ops import transform as shapely_transform
import stackstac
import xarray as xr

DEFAULT_STAC_API = os.getenv("STAC_API_URL", "https://earth-search.aws.element84.com/v1")
GEOD = Geod(ellps="WGS84")
WGS84 = "EPSG:4326"
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
        groups: dict[str, List[SceneSelection]] = {}
        for item in search.items():
            try:
                _ensure_intersection(item, aoi_bounds)
            except SceneValidationError:
                continue
            key = _datatake_key(item)
            groups.setdefault(key, []).append(SceneSelection(item=item, bbox=aoi_bounds))
            if sum(len(group) for group in groups.values()) >= max_scenes * 2:
                break

        if not groups:
            continue

        ordered_groups = sorted(
            groups.items(),
            key=lambda kv: (len(kv[1]), _item_datetime(kv[1][0].item)),
            reverse=True,
        )
        for _, group in ordered_groups:
            if group:
                return group[:max_scenes]

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
        stacks.append(stack)

    if not stacks:
        raise SceneValidationError(
            "Selected area does not intersect the Sentinel-2 scenes; try a different date or size."
        )

    combined = xr.concat(stacks, dim="scene")
    mosaic = da.nanmedian(combined.data, axis=0)
    mosaic = mosaic.astype("float32")
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
