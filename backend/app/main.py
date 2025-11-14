from __future__ import annotations

import logging
import os
from typing import Dict

from fastapi import FastAPI, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware

from app.models import ExportRequest, PreviewRequest, PreviewResponse, SceneMetadata
from app.processing import compose, fetch, overlays, render
from app.processing.fetch import (
    SceneNotFoundError,
    SceneSearchError,
    SceneValidationError,
)

LOGGER = logging.getLogger(__name__)
PREVIEW_MAX_PX = int(os.getenv("PREVIEW_MAX_PX", "1024"))
DEFAULT_GAMMA = {
    "true": 1.0,
    "truecolor": 1.0,
    "false_veg": 1.0,
    "falseveg": 1.0,
    "ndvi": 1.05,
    "pca": 0.95,
    "geology": 1.1,
    "decorr": 0.95,
    "nmf": 1.0,
    "index_triplet": 0.95,
}

app = FastAPI(title="Earth Art API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


def _date_range(request: PreviewRequest) -> str | None:
    if request.date_range:
        return request.date_range.to_timerange()
    return None


def _scene_metadata(selection: fetch.SceneSelection) -> SceneMetadata:
    item = selection.item
    props = item.properties
    assets = {name: asset.href for name, asset in item.assets.items()}
    return SceneMetadata(
        id=item.id,
        datetime=props.get("datetime", ""),
        cloud_coverage=props.get("eo:cloud_cover", 0.0),
        collection=item.collection_id,
        assets=assets,
    )


def _run_pipeline(request: PreviewRequest, target_pixels: int):
    try:
        stack, selection, stack_crs = fetch.fetch_raster_stack(
            request.lat,
            request.lon,
            request.size_km,
            request.theme,
            target_pixels,
            date_range=_date_range(request),
        )
    except SceneNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except SceneValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except SceneSearchError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    apply_stretch = True
    background = request.background
    if background and background.mode == "solid":
        width = selection.width or int(stack.sizes.get("x", stack.shape[-1]))
        height = selection.height or int(stack.sizes.get("y", stack.shape[-2]))
        rgb = render.make_solid_canvas(height, width, background.color or "#0e0e10")
        apply_stretch = False
    else:
        rgb = compose.build_theme(stack, request.theme, request=request)
    gamma = DEFAULT_GAMMA.get(request.theme, 1.0)
    image = render.to_image(rgb, gamma=gamma, apply_stretch=apply_stretch)
    osm_features = {}
    if request.overlays.any_enabled():
        osm_features = overlays.fetch_osm_features(selection.bbox, request.overlays)
    image = overlays.draw_vectors(
        image=image,
        selection=selection,
        overlays=osm_features,
        want_roads=bool(request.overlays.roads),
        want_buildings=bool(request.overlays.buildings),
        styles=request.overlayStyles,
    )
    return image, selection


@app.post("/preview", response_model=PreviewResponse)
def preview(request: PreviewRequest) -> PreviewResponse:
    image, selection = _run_pipeline(request, target_pixels=PREVIEW_MAX_PX)
    image = render.resize_image(image, PREVIEW_MAX_PX)
    _, encoded = render.encode_png(image)
    return PreviewResponse(
        png_base64=encoded,
        bbox=list(selection.bbox),
        scene_metadata=_scene_metadata(selection),
    )


@app.post("/export")
def export(request: ExportRequest) -> Response:
    target_px = max(request.target_size_px, PREVIEW_MAX_PX)
    image, selection = _run_pipeline(request, target_pixels=target_px)
    image = render.scale_to_max(image, request.target_size_px)
    if request.watermark:
        image = render.add_watermark(image, request.watermark)
    raw, _ = render.encode_png(image)
    filename = f"earth-art-{selection.item.id}-{request.theme}.png"
    return Response(
        content=raw,
        media_type="image/png",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
