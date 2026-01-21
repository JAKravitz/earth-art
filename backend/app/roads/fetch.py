from __future__ import annotations

import logging
import math
import os
import warnings
from pathlib import Path
from typing import TYPE_CHECKING

from shapely import affinity
from shapely.geometry import shape

if TYPE_CHECKING:
    import geopandas as gpd

LOGGER = logging.getLogger(__name__)

PREVIEW_MAX_KM = float(os.getenv("ROADS_PREVIEW_MAX_KM", "0"))
PREVIEW_MAX_FEATURES = int(os.getenv("ROADS_PREVIEW_MAX_FEATURES", "12000"))
PREVIEW_SIMPLIFY_M = float(os.getenv("ROADS_PREVIEW_SIMPLIFY_M", "6"))
PREVIEW_TIMEOUT_SEC = int(os.getenv("ROADS_PREVIEW_TIMEOUT_SEC", "30"))
RENDER_TIMEOUT_SEC = int(os.getenv("ROADS_RENDER_TIMEOUT_SEC", "90"))
CACHE_DIR = Path(os.getenv("ROADS_OSM_CACHE_DIR", str(Path(__file__).parent / "_osm_cache")))
NETWORK_TYPE = os.getenv("ROADS_OSM_NETWORK_TYPE", "drive")
OVERPASS_ENDPOINT = os.getenv("ROADS_OVERPASS_ENDPOINT")

MAJOR_HIGHWAYS = {
    "motorway",
    "motorway_link",
    "trunk",
    "trunk_link",
    "primary",
    "primary_link",
    "secondary",
    "secondary_link",
    "tertiary",
    "tertiary_link",
}


def _extract_geometry(aoi_geojson: dict):
    if isinstance(aoi_geojson, dict) and aoi_geojson.get("type") == "Feature" and aoi_geojson.get("geometry"):
        return shape(aoi_geojson["geometry"])
    return shape(aoi_geojson)


def _bbox_size_km(bounds: tuple[float, float, float, float]) -> tuple[float, float]:
    minx, miny, maxx, maxy = bounds
    center_lat = (miny + maxy) / 2
    width_km = abs(maxx - minx) * 111.32 * math.cos(math.radians(center_lat))
    height_km = abs(maxy - miny) * 110.574
    return width_km, height_km


def prepare_aoi_geometry(aoi_geojson: dict, *, preview: bool) -> "shapely.geometry.base.BaseGeometry":
    geometry = _extract_geometry(aoi_geojson)
    if preview and PREVIEW_MAX_KM > 0:
        width_km, height_km = _bbox_size_km(geometry.bounds)
        max_side_km = max(width_km, height_km)
        if max_side_km > PREVIEW_MAX_KM:
            scale = PREVIEW_MAX_KM / max_side_km
            geometry = affinity.scale(geometry, xfact=scale, yfact=scale, origin="center")
    return geometry


def _configure_osmnx(preview: bool) -> None:
    import osmnx as ox

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    ox.settings.use_cache = True
    ox.settings.cache_folder = str(CACHE_DIR)
    ox.settings.overpass_rate_limit = False
    ox.settings.log_console = False
    timeout = PREVIEW_TIMEOUT_SEC if preview else RENDER_TIMEOUT_SEC
    ox.settings.timeout = timeout
    ox.settings.requests_timeout = timeout
    if OVERPASS_ENDPOINT:
        ox.settings.overpass_endpoint = OVERPASS_ENDPOINT


def _empty_edges() -> "gpd.GeoDataFrame":
    import geopandas as gpd

    return gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")


def _classify_highway(value) -> str:
    if isinstance(value, (list, tuple, set)):
        values = list(value)
    else:
        values = [value]
    for item in values:
        if item in MAJOR_HIGHWAYS:
            return "major"
    return "minor"


def _normalize_edges(edges: "gpd.GeoDataFrame") -> "gpd.GeoDataFrame":
    if edges is None or edges.empty:
        return _empty_edges()
    edges = edges.copy()
    edges = edges[~edges.geometry.isna()]
    edges = edges[edges.geom_type.isin(["LineString", "MultiLineString"])]
    if edges.crs is None:
        edges = edges.set_crs("EPSG:4326")
    else:
        edges = edges.to_crs("EPSG:4326")
    return edges


def _simplify_edges(edges: "gpd.GeoDataFrame", tolerance_m: float) -> "gpd.GeoDataFrame":
    if edges.empty or tolerance_m <= 0:
        return edges
    edges_proj = edges.to_crs("EPSG:3857")
    edges_proj["geometry"] = edges_proj.geometry.simplify(tolerance_m, preserve_topology=True)
    edges_proj = edges_proj[~edges_proj.geometry.is_empty]
    return edges_proj.to_crs("EPSG:4326")


def _limit_edges(edges: "gpd.GeoDataFrame") -> "gpd.GeoDataFrame":
    if edges.empty or PREVIEW_MAX_FEATURES <= 0 or len(edges) <= PREVIEW_MAX_FEATURES:
        return edges
    if "length" in edges.columns:
        edges = edges.sort_values(by="length", ascending=False, kind="mergesort")
    return edges.iloc[:PREVIEW_MAX_FEATURES].copy()


def fetch_road_edges(
    aoi_geojson: dict,
    *,
    preview: bool = True,
    geometry: "shapely.geometry.base.BaseGeometry | None" = None,
) -> "gpd.GeoDataFrame":
    """Fetch OSM road geometries clipped to the AOI."""
    import geopandas as gpd
    import osmnx as ox

    geometry = geometry or prepare_aoi_geometry(aoi_geojson, preview=preview)
    _configure_osmnx(preview)

    try:
        with warnings.catch_warnings():
            warnings.filterwarnings(
                "ignore",
                message=r"The expected order of coordinates in `bbox` will change.*",
                category=FutureWarning,
            )
            warnings.filterwarnings(
                "ignore",
                message=r"The `north`, `south`, `east`, and `west` parameters are deprecated.*",
                category=FutureWarning,
            )
            warnings.filterwarnings(
                "ignore",
                message=r"`settings.timeout` is deprecated.*",
                category=FutureWarning,
            )
            graph = ox.graph_from_polygon(geometry, network_type=NETWORK_TYPE, simplify=True)
    except Exception:
        LOGGER.exception("Failed to fetch OSM roads")
        return _empty_edges()

    if graph is None:
        return _empty_edges()

    try:
        edges = ox.graph_to_gdfs(graph, nodes=False, edges=True, fill_edge_geometry=True)
    except Exception:
        return _empty_edges()

    edges = _normalize_edges(edges)
    if edges.empty:
        return edges

    try:
        edges = gpd.clip(edges, geometry)
    except Exception:
        LOGGER.exception("Failed to clip road edges to AOI")
        edges = edges

    edges = edges[~edges.geometry.is_empty]
    edges["road_class"] = edges["highway"].apply(_classify_highway) if "highway" in edges.columns else "minor"

    if preview:
        if len(edges) > PREVIEW_MAX_FEATURES:
            edges = _simplify_edges(edges, PREVIEW_SIMPLIFY_M)
        edges = _limit_edges(edges)

    return edges
