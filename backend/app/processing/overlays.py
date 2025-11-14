"""Fetch and rasterize OpenStreetMap overlays."""
from __future__ import annotations

import logging
from typing import Dict, List, Tuple

import numpy as np
import requests
from PIL import Image, ImageColor, ImageDraw
from pyproj import Transformer
from shapely.geometry import LineString, Polygon

from app.models import OverlayOptions, OverlayStyles
from app.processing.fetch import SceneSelection

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
LOGGER = logging.getLogger(__name__)


def _build_query(bbox: Tuple[float, float, float, float], overlays: OverlayOptions) -> str:
    south, west, north, east = bbox[1], bbox[0], bbox[3], bbox[2]
    queries: List[str] = []
    if overlays.roads:
        queries.append(f'way["highway"]({south},{west},{north},{east});')
    if overlays.buildings:
        queries.append(f'way["building"]({south},{west},{north},{east});')
    inner = "".join(queries)
    return f"[out:json][timeout:25];({inner});out geom;"


def fetch_osm_features(bbox: Tuple[float, float, float, float], overlays: OverlayOptions) -> Dict[str, List]:
    if not overlays.any_enabled():
        return {}
    try:
        response = requests.post(
            OVERPASS_URL,
            data={"data": _build_query(bbox, overlays)},
            timeout=30,
            headers={"User-Agent": "earth-art-mvp"},
        )
        response.raise_for_status()
    except requests.RequestException as exc:  # pragma: no cover - network guard
        LOGGER.warning("Unable to fetch OSM overlays: %s", exc)
        return {}
    data = response.json()
    results: Dict[str, List] = {"roads": [], "buildings": []}
    for element in data.get("elements", []):
        geom = element.get("geometry", [])
        if not geom:
            continue
        coords = [(pt["lon"], pt["lat"]) for pt in geom]
        if element.get("type") != "way" or len(coords) < 2:
            continue
        tags = element.get("tags", {})
        if overlays.roads and "highway" in tags:
            results["roads"].append(LineString(coords))
        if overlays.buildings and "building" in tags:
            if coords[0] == coords[-1] and len(coords) >= 4:
                results["buildings"].append(Polygon(coords))
            else:
                results["buildings"].append(LineString(coords))
    return {k: v for k, v in results.items() if v}


def _parse_color(value: str | None, default: str) -> Tuple[int, int, int]:
    try:
        return ImageColor.getrgb(value) if value else ImageColor.getrgb(default)
    except Exception:
        return ImageColor.getrgb(default)


def _style_value(style, attr: str, default):
    if not style:
        return default
    value = getattr(style, attr, None)
    return default if value is None else value


def _projector(selection: SceneSelection, image: Image.Image):
    if selection.x_coords is None or selection.y_coords is None:
        return None
    x_coords = np.asarray(selection.x_coords, dtype="float64")
    y_coords = np.asarray(selection.y_coords, dtype="float64")
    x_min, x_max = float(x_coords.min()), float(x_coords.max())
    y_min, y_max = float(y_coords.min()), float(y_coords.max())
    width, height = image.size
    transformer = None
    if selection.crs and selection.crs != "EPSG:4326":
        transformer = Transformer.from_crs("EPSG:4326", selection.crs, always_xy=True)

    def project_point(lon: float, lat: float) -> Tuple[float, float]:
        if transformer:
            x, y = transformer.transform(lon, lat)
        else:
            x, y = lon, lat
        px = (x - x_min) / (x_max - x_min) * (width - 1) if x_max != x_min else width / 2
        py = (y_max - y) / (y_max - y_min) * (height - 1) if y_max != y_min else height / 2
        return px, py

    return project_point


def draw_vectors(
    image: Image.Image,
    selection: SceneSelection,
    overlays: Dict[str, List],
    want_roads: bool,
    want_buildings: bool,
    styles: OverlayStyles | None = None,
) -> Image.Image:
    if not overlays or (not want_roads and not want_buildings):
        return image
    projector = _projector(selection, image)
    if not projector:
        return image

    draw = ImageDraw.Draw(image, "RGBA")
    road_style = styles.roads if styles else None
    bld_style = styles.buildings if styles else None
    road_color = _parse_color(_style_value(road_style, "color", None), "#00FFFF")
    road_width = int(max(1, round(float(_style_value(road_style, "width", 2.0)))))
    road_opacity = float(_style_value(road_style, "opacity", 1.0))
    road_alpha = int(max(0, min(1, road_opacity)) * 255)

    bld_color = _parse_color(_style_value(bld_style, "color", None), "#FF00FF")
    bld_width = int(max(0, round(float(_style_value(bld_style, "width", 1.0)))))
    bld_opacity = float(_style_value(bld_style, "opacity", 0.8))
    bld_alpha = int(max(0, min(1, bld_opacity)) * 255)
    bld_fill = float(_style_value(bld_style, "fill_opacity", 0.15))
    bld_fill_alpha = int(max(0, min(1, bld_fill)) * 255)

    def project_geometry(geom):
        if isinstance(geom, Polygon):
            coords = geom.exterior.coords
        else:
            coords = geom.coords
        return [projector(lon, lat) for lon, lat in coords]

    if want_roads and "roads" in overlays:
        for geom in overlays["roads"]:
            coords = project_geometry(geom)
            draw.line(coords, fill=(road_color[0], road_color[1], road_color[2], road_alpha), width=road_width)

    if want_buildings and "buildings" in overlays:
        for geom in overlays["buildings"]:
            coords = project_geometry(geom)
            if isinstance(geom, Polygon):
                draw.polygon(
                    coords,
                    fill=(bld_color[0], bld_color[1], bld_color[2], bld_fill_alpha),
                    outline=(bld_color[0], bld_color[1], bld_color[2], bld_alpha),
                )
                if bld_width > 0:
                    draw.line(coords + [coords[0]], fill=(bld_color[0], bld_color[1], bld_color[2], bld_alpha), width=bld_width)
            else:
                draw.line(coords, fill=(bld_color[0], bld_color[1], bld_color[2], bld_alpha), width=max(1, bld_width))

    return image
