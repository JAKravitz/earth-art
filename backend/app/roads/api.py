from __future__ import annotations

import hashlib
import json
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from io import BytesIO
from typing import Literal, Optional

from fastapi import APIRouter, Response
from pydantic import BaseModel, Field
from shapely.geometry import mapping

from app.roads.fetch import PREVIEW_TIMEOUT_SEC, fetch_road_edges, prepare_aoi_geometry
from app.roads.render import render_roads_preview

router = APIRouter()

MAX_PREVIEW_PX = 2048
FETCH_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="roads-preview")


class RoadPreviewRequest(BaseModel):
    aoi: dict
    style: Literal["blueprint", "gold", "ink"] = "blueprint"
    width_px: int = Field(default=1536, ge=256)
    height_px: int = Field(default=1536, ge=256)
    seed: Optional[int] = None


def _clamp_px(value: int) -> int:
    return max(256, min(MAX_PREVIEW_PX, value))


def _seed_from_aoi(aoi: dict, style: str) -> int:
    payload = {"aoi": aoi, "style": style}
    serialized = json.dumps(payload, sort_keys=True).encode("utf-8")
    digest = hashlib.sha256(serialized).hexdigest()
    return int(digest[:8], 16)


def _fetch_roads(aoi_serialized: str):
    return fetch_road_edges(json.loads(aoi_serialized), preview=True)


@router.post("/roads/preview")
def roads_preview(request: RoadPreviewRequest) -> Response:
    width = _clamp_px(request.width_px)
    height = _clamp_px(request.height_px)
    seed = request.seed if request.seed is not None else _seed_from_aoi(request.aoi, request.style)
    effective_geometry = prepare_aoi_geometry(request.aoi, preview=True)
    effective_aoi = mapping(effective_geometry)
    aoi_serialized = json.dumps(effective_aoi, sort_keys=True)
    future = FETCH_EXECUTOR.submit(_fetch_roads, aoi_serialized)
    try:
        roads = future.result(timeout=PREVIEW_TIMEOUT_SEC)
    except TimeoutError:
        future.cancel()
        import geopandas as gpd

        roads = gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")
    image = render_roads_preview(
        roads,
        effective_aoi,
        style=request.style,
        width=width,
        height=height,
        seed=seed,
    )
    buffer = BytesIO()
    image.convert("RGBA").save(buffer, format="PNG")
    return Response(content=buffer.getvalue(), media_type="image/png")
