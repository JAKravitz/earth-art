from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Iterable, Tuple

import numpy as np
from PIL import Image, ImageColor, ImageDraw, ImageFilter
from shapely.geometry import LineString, MultiLineString

from .styles import get_style


@dataclass(frozen=True)
class RenderConfig:
    width: int
    height: int
    seed: int


def _seed_from_aoi(aoi_geojson: dict, style: str) -> int:
    payload = {"aoi": aoi_geojson, "style": style}
    serialized = json.dumps(payload, sort_keys=True).encode("utf-8")
    digest = hashlib.sha256(serialized).hexdigest()
    return int(digest[:8], 16)


def _color(color: str, opacity: float = 1.0) -> Tuple[int, int, int, int]:
    r, g, b = ImageColor.getrgb(color)
    alpha = max(0, min(255, int(opacity * 255)))
    return (r, g, b, alpha)


def _to_image_coords(
    bounds: Tuple[float, float, float, float],
    x: float,
    y: float,
    width: int,
    height: int,
) -> Tuple[float, float]:
    minx, miny, maxx, maxy = bounds
    if maxx == minx or maxy == miny:
        return (0.0, 0.0)
    px = (x - minx) / (maxx - minx) * width
    py = height - (y - miny) / (maxy - miny) * height
    return (px, py)


def _iter_lines(geometry) -> Iterable[LineString]:
    if isinstance(geometry, MultiLineString):
        return geometry.geoms
    if isinstance(geometry, LineString):
        return [geometry]
    return []


def _draw_line(
    draw: ImageDraw.ImageDraw,
    coords: Iterable[Tuple[float, float]],
    bounds: Tuple[float, float, float, float],
    config: RenderConfig,
    color: str,
    width: float,
    opacity: float = 1.0,
) -> None:
    points = [_to_image_coords(bounds, x, y, config.width, config.height) for x, y in coords]
    if len(points) < 2:
        return
    draw.line(points, fill=_color(color, opacity), width=max(1, int(width)), joint="curve")


def _draw_glow(
    glow_layer: Image.Image,
    coords: Iterable[Tuple[float, float]],
    bounds: Tuple[float, float, float, float],
    config: RenderConfig,
    color: str,
    width: float,
    opacity: float,
) -> None:
    draw = ImageDraw.Draw(glow_layer, "RGBA")
    points = [_to_image_coords(bounds, x, y, config.width, config.height) for x, y in coords]
    if len(points) < 2:
        return
    draw.line(points, fill=_color(color, opacity), width=max(1, int(width)), joint="curve")


def _adjust_rgb(color: str, delta: int) -> Tuple[int, int, int]:
    r, g, b = ImageColor.getrgb(color)
    return (
        max(0, min(255, r + delta)),
        max(0, min(255, g + delta)),
        max(0, min(255, b + delta)),
    )


def _draw_paper_grain(
    image: Image.Image,
    config: RenderConfig,
    rng: np.random.Generator,
    base_color: str,
) -> None:
    noise_w = max(64, config.width // 10)
    noise_h = max(64, config.height // 10)
    noise = rng.normal(0.0, 1.0, size=(noise_h, noise_w))
    noise = np.clip(noise, -2.4, 2.4)
    noise = ((noise + 2.4) / 4.8 * 255).astype(np.uint8)
    noise_img = Image.fromarray(noise, mode="L").resize((config.width, config.height), resample=Image.BICUBIC)
    noise_img = noise_img.filter(ImageFilter.GaussianBlur(radius=2.2))
    alpha = noise_img.point(lambda v: int(v * 0.06))
    grain_color = _adjust_rgb(base_color, -18)
    grain = Image.new("RGBA", (config.width, config.height), grain_color)
    grain.putalpha(alpha)
    image.alpha_composite(grain)


def render_roads_preview(
    roads: "gpd.GeoDataFrame",
    aoi_geojson: dict,
    *,
    style: str,
    width: int,
    height: int,
    seed: int | None = None,
) -> Image.Image:
    import geopandas as gpd
    from shapely.geometry import shape

    style_cfg = get_style(style)
    if seed is None:
        seed = _seed_from_aoi(aoi_geojson, style)
    rng = np.random.default_rng(seed)
    config = RenderConfig(width=width, height=height, seed=seed)
    scale = max(width, height) / 1536
    aoi_geom = shape(aoi_geojson.get("geometry", aoi_geojson))
    aoi_series = gpd.GeoSeries([aoi_geom], crs="EPSG:4326").to_crs("EPSG:3857")
    bounds = aoi_series.iloc[0].bounds

    image = Image.new("RGBA", (width, height), ImageColor.getrgb(style_cfg.background))
    if style_cfg.grain:
        _draw_paper_grain(image, config, rng, style_cfg.background)

    if roads is None or roads.empty:
        return image

    roads_proj = roads.to_crs("EPSG:3857")
    if "road_class" in roads_proj.columns:
        major_roads = roads_proj[roads_proj["road_class"] == "major"]
        minor_roads = roads_proj[roads_proj["road_class"] != "major"]
    else:
        major_roads = roads_proj.iloc[0:0]
        minor_roads = roads_proj

    draw = ImageDraw.Draw(image, "RGBA")
    if style_cfg.secondary_color:
        for _, row in minor_roads.iterrows():
            for line in _iter_lines(row.geometry):
                _draw_line(
                    draw,
                    line.coords,
                    bounds,
                    config,
                    style_cfg.secondary_color,
                    style_cfg.minor_width * scale,
                    style_cfg.secondary_opacity,
                )

    for _, row in minor_roads.iterrows():
        for line in _iter_lines(row.geometry):
            _draw_line(
                draw,
                line.coords,
                bounds,
                config,
                style_cfg.minor_color,
                style_cfg.minor_width * scale,
                style_cfg.minor_opacity,
            )

    if style_cfg.glow_color:
        glow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        glow_width = (style_cfg.glow_width or style_cfg.major_width * 2.4) * scale
        for _, row in major_roads.iterrows():
            for line in _iter_lines(row.geometry):
                _draw_glow(
                    glow,
                    line.coords,
                    bounds,
                    config,
                    style_cfg.glow_color,
                    glow_width,
                    0.6,
                )
        blur_radius = max(1.0, style_cfg.glow_blur * scale)
        glow = glow.filter(ImageFilter.GaussianBlur(radius=blur_radius))
        image = Image.alpha_composite(image, glow)
        draw = ImageDraw.Draw(image, "RGBA")

    for _, row in major_roads.iterrows():
        for line in _iter_lines(row.geometry):
            _draw_line(
                draw,
                line.coords,
                bounds,
                config,
                style_cfg.major_color,
                style_cfg.major_width * scale,
                style_cfg.major_opacity,
            )

    return image
