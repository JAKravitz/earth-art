from __future__ import annotations

import logging
import os
import asyncio
from pathlib import Path
from typing import Dict, List
from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError

from fastapi import FastAPI, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware

from app.models import (
    BatchPreviewItem,
    BatchPreviewRequest,
    BatchPreviewResponse,
    ExportFilterRequest,
    ExportRequest,
    PreviewRequest,
    PreviewResponse,
    SceneMetadata,
)
from app.processing import compose, fetch, overlays, render
from app.processing.fetch import SceneNotFoundError, SceneSearchError, SceneValidationError
from app.processing.filters import render_filter
from app.roads import router as roads_router

LOGGER = logging.getLogger(__name__)
PREVIEW_MAX_PX = int(os.getenv("PREVIEW_MAX_PX", "2048"))
PREVIEW_EXECUTOR = ThreadPoolExecutor(
    max_workers=max(4, min(8, os.cpu_count() or 4)),
    thread_name_prefix="preview",
)
WATERMARK_PATH = Path(__file__).parent / "assets" / "planetory-logo.png"
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
app.include_router(roads_router)


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


def _date_range(request: PreviewRequest) -> str | None:
    if request.date_range:
        return request.date_range.to_timerange()
    return None


@app.on_event("shutdown")
def _shutdown_executor() -> None:
    PREVIEW_EXECUTOR.shutdown(wait=False, cancel_futures=True)


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
            aoi_bounds=tuple(request.aoi_bounds) if request.aoi_bounds else None,
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
    watermark = render.load_watermark(WATERMARK_PATH)
    if watermark or request.watermark:
        image = render.add_watermark(image, watermark_image=watermark, text=request.watermark)
    raw, _ = render.encode_png(image)
    filename = f"earth-art-{selection.item.id}-{request.theme}.png"
    return Response(
        content=raw,
        media_type="image/png",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


def _prepare_stack_for_filters(
    lat: float,
    lon: float,
    size_km: float,
    pixels: int,
    date_range: str | None,
    aoi_bounds: tuple[float, float, float, float] | None,
):
    return fetch.fetch_raster_stack(
        lat,
        lon,
        size_km,
        "pca",
        pixels,
        date_range=date_range,
        aoi_bounds=aoi_bounds,
    )


@app.post("/filters/preview", response_model=BatchPreviewResponse)
def batch_preview(request: BatchPreviewRequest) -> BatchPreviewResponse:
    try:
        stack, selection, _ = _prepare_stack_for_filters(
            request.lat,
            request.lon,
            request.size_km,
            request.target_size_px,
            date_range=_date_range(request),
            aoi_bounds=tuple(request.aoi_bounds) if request.aoi_bounds else None,
        )
        # Ensure previews reuse an in-memory stack instead of recomputing dask
        # graphs per filter, which can time out and yield black placeholders.
        if hasattr(stack.data, "compute"):
            stack = stack.copy(data=stack.data.compute())
    except (SceneNotFoundError, SceneValidationError, SceneSearchError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    results: List[BatchPreviewItem] = []

    def _render_one(spec):
        rgb = render_filter(stack, selection, spec, preview_mode=True)
        image = render.to_image(rgb, gamma=1.0, apply_stretch=False)
        image = render.resize_image(image, min(request.target_size_px, PREVIEW_MAX_PX))
        _, encoded = render.encode_png(image)
        return BatchPreviewItem(
            id=spec.id,
            png_base64=encoded,
            bbox=list(selection.bbox),
            scene_metadata=_scene_metadata(selection),
        )

    futures = {PREVIEW_EXECUTOR.submit(_render_one, spec): spec.id for spec in request.filters}
    completed: set[str] = set()
    try:
        for fut in as_completed(futures, timeout=60):
            fid = futures[fut]
            completed.add(fid)
            results.append(fut.result())
    except TimeoutError:
        for fut in futures:
            if not fut.done():
                fut.cancel()
        for fid in futures.values():
            if fid in completed:
                continue
            solid = render.make_solid_canvas(32, 32, "#000000")
            img = render.to_image(solid, apply_stretch=False)
            _, encoded = render.encode_png(img)
            results.append(
                BatchPreviewItem(
                    id=fid,
                    png_base64=encoded,
                    bbox=list(selection.bbox),
                    scene_metadata=_scene_metadata(selection),
                )
            )
    except (KeyboardInterrupt, asyncio.CancelledError):
        PREVIEW_EXECUTOR.shutdown(wait=False, cancel_futures=True)
        raise
    return BatchPreviewResponse(results=results)


@app.post("/filters/export")
def export_filter(request: ExportFilterRequest) -> Response:
    try:
        stack, selection, _ = _prepare_stack_for_filters(
            request.lat,
            request.lon,
            request.size_km,
            request.target_size_px,
            date_range=_date_range(request),
            aoi_bounds=tuple(request.aoi_bounds) if request.aoi_bounds else None,
        )
        if hasattr(stack.data, "compute"):
            stack = stack.copy(data=stack.data.compute())
    except (SceneNotFoundError, SceneValidationError, SceneSearchError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    rgb = render_filter(stack, selection, request.filter, preview_mode=False)
    image = render.to_image(rgb, gamma=1.0, apply_stretch=False)
    if request.adjustments:
        image = render.apply_enhancements(
            image,
            {
                "brightness": float(request.adjustments.get("brightness", 1.0)),
                "contrast": float(request.adjustments.get("contrast", 1.0)),
                "saturation": float(request.adjustments.get("saturation", 1.0)),
            },
        )
    image = render.scale_to_max(image, request.target_size_px)
    watermark = render.load_watermark(WATERMARK_PATH)
    if watermark or request.watermark:
        image = render.add_watermark(image, watermark_image=watermark, text=request.watermark)
    raw, _ = render.encode_png(image)
    filename = f"earth-art-{request.filter.id}.png"
    return Response(
        content=raw,
        media_type="image/png",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
