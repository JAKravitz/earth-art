"""REM (River Relative Elevation Model) API: preview and export using RiverREM + OpenTopography DEM."""
from __future__ import annotations

import io
import logging
import os
import tempfile
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from pathlib import Path
from typing import Optional, Tuple

from fastapi import APIRouter, HTTPException, Response, status
from PIL import Image
from pydantic import BaseModel, Field
import rasterio
from rasterio.enums import Resampling
import requests

router = APIRouter()
LOGGER = logging.getLogger(__name__)

REM_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="rem")
OPENTOPOGRAPHY_API_KEY = os.getenv("OPENTOPOGRAPHY_API_KEY")
OPENTOPOGRAPHY_GLOBALDEM_URL = "https://portal.opentopography.org/API/globaldem"
# DEM type for OpenTopography Global DEM API. Options (see Awesome-DEM / opentopography.org):
#   COP30    - Copernicus GLO-30, 30m (default); finer detail, closer to tutorial-style REMs.
#   SRTMGL1  - SRTM 1 arc-sec, 30m, smaller area limit.
#   SRTMGL3  - SRTM 3 arc-sec, 90m; use for very large areas if COP30 hits limits.
#   COP90    - Copernicus GLO-90, 90m.
DEFAULT_DEM_TYPE = os.getenv("REM_DEM_TYPE", "COP30")
PREVIEW_MAX_PX = int(os.getenv("REM_PREVIEW_MAX_PX", "1024"))
EXPORT_MAX_PX = int(os.getenv("REM_EXPORT_MAX_PX", "4096"))


class REMPreviewRequest(BaseModel):
    bbox: Tuple[float, float, float, float] = Field(
        ...,
        description="[west, south, east, north] in WGS84",
    )
    target_size_px: Optional[int] = Field(default=1024, ge=256, le=2048)
    colormap: Optional[str] = Field(default="topo")
    hillshade_z: Optional[float] = Field(default=5.0, ge=1.0, le=20.0)
    blend_percent: Optional[float] = Field(default=25.0, ge=0.0, le=100.0)


class REMExportRequest(BaseModel):
    bbox: Tuple[float, float, float, float] = Field(
        ...,
        description="[west, south, east, north] in WGS84",
    )
    target_size_px: int = Field(default=4096, ge=512, le=8192)
    colormap: Optional[str] = Field(default="topo")
    hillshade_z: Optional[float] = Field(default=5.0, ge=1.0, le=20.0)
    blend_percent: Optional[float] = Field(default=25.0, ge=0.0, le=100.0)


def _bbox_to_ot_params(bbox: Tuple[float, float, float, float]) -> dict:
    west, south, east, north = bbox
    return {"north": north, "south": south, "east": east, "west": west}


def _fetch_dem_to_file(bbox: Tuple[float, float, float, float], out_path: Path) -> None:
    """Fetch DEM for bbox from OpenTopography and write to out_path (GeoTIFF)."""
    if not OPENTOPOGRAPHY_API_KEY:
        raise RuntimeError(
            "OPENTOPOGRAPHY_API_KEY is not set. Register at opentopography.org and add the key to your .env."
        )
    params = {
        **_bbox_to_ot_params(bbox),
        "demtype": DEFAULT_DEM_TYPE,
        "outputFormat": "GTiff",
        "API_Key": OPENTOPOGRAPHY_API_KEY,
    }
    resp = requests.get(OPENTOPOGRAPHY_GLOBALDEM_URL, params=params, timeout=120)
    resp.raise_for_status()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(resp.content)


def _cog_to_plain_geotiff(cog_path: Path, plain_path: Path) -> None:
    """Rewrite a COG GeoTIFF to a plain GeoTIFF so GDAL opens it reliably for RiverREM."""
    with rasterio.open(cog_path) as src:
        data = src.read()
        profile = src.profile.copy()
    for key in ("tiled", "blockxsize", "blockysize"):
        profile.pop(key, None)
    profile.update(driver="GTiff", tiled=False, compress="lzw")
    with rasterio.open(plain_path, "w", **profile) as dst:
        dst.write(data)


def _resample_dem_to_target_size(
    dem_path: Path, out_path: Path, target_long_side_px: int
) -> None:
    """Resample DEM so the longer side has target_long_side_px pixels; REM will be sharp at preview size."""
    with rasterio.open(dem_path) as src:
        h, w = src.height, src.width
        if max(h, w) <= target_long_side_px:
            # Upsample: scale so long side = target
            scale = target_long_side_px / max(h, w)
        else:
            scale = target_long_side_px / max(h, w)
        out_h = int(round(h * scale))
        out_w = int(round(w * scale))
        out_h = max(out_h, 64)
        out_w = max(out_w, 64)
        data = src.read(
            out_shape=(src.count, out_h, out_w),
            resampling=Resampling.cubic,
        )
        transform = src.transform * src.transform.scale(
            src.width / out_w,
            src.height / out_h,
        )
        profile = src.profile.copy()
    for key in ("tiled", "blockxsize", "blockysize"):
        profile.pop(key, None)
    profile.update(
        driver="GTiff",
        height=out_h,
        width=out_w,
        transform=transform,
        tiled=False,
        compress="lzw",
    )
    with rasterio.open(out_path, "w", **profile) as dst:
        dst.write(data)


def _run_rem_and_make_viz(
    dem_path: Path,
    out_dir: Path,
    cache_dir: Path,
    colormap: str = "topo",
    hillshade_z: float = 5.0,
    blend_percent: float = 25.0,
) -> Path:
    """Run RiverREM make_rem() and make_rem_viz(); return path to output PNG.
    hillshade_z=5 and blend_percent follow Dan Coe's REM tutorials (soft-light hillshade for definition).
    """
    try:
        from riverrem.REMMaker import REMMaker
    except ImportError as e:
        raise RuntimeError(
            "RiverREM is not installed. Install with: conda install -c conda-forge riverrem. "
            "Then run the backend using the REM conda environment (see backend/README.md)."
        ) from e
    rem_maker = REMMaker(
        dem=str(dem_path),
        out_dir=str(out_dir),
        cache_dir=str(cache_dir),
    )
    rem_maker.make_rem()
    rem_maker.make_rem_viz(
        cmap=colormap,
        z=hillshade_z,
        blend_percent=blend_percent,
    )
    # RiverREM writes e.g. *_rem_viz.png or similar; find the PNG
    pngs = list(out_dir.glob("*rem*viz*.png")) or list(out_dir.glob("*.png"))
    if not pngs:
        raise RuntimeError("RiverREM did not produce a PNG output.")
    return pngs[0]


def _rem_pipeline(
    bbox: Tuple[float, float, float, float],
    target_size_px: int,
    colormap: str,
    hillshade_z: float = 5.0,
    blend_percent: float = 25.0,
) -> bytes:
    """Fetch DEM, run REM, return PNG bytes."""
    with tempfile.TemporaryDirectory(prefix="rem_") as tmp:
        tmp_path = Path(tmp)
        dem_cog = tmp_path / "dem_cog.tif"
        dem_path = tmp_path / "dem.tif"
        _fetch_dem_to_file(bbox, dem_cog)
        _cog_to_plain_geotiff(dem_cog, dem_path)
        # Resample DEM to target size so RiverREM produces a sharp preview (no blurry upscale).
        dem_resampled = tmp_path / "dem_resampled.tif"
        _resample_dem_to_target_size(dem_path, dem_resampled, target_size_px)
        out_dir = tmp_path / "rem_out"
        out_dir.mkdir()
        cache_dir = tmp_path / ".cache"
        png_path = _run_rem_and_make_viz(
            dem_resampled,
            out_dir,
            cache_dir,
            colormap=colormap or "topo",
            hillshade_z=hillshade_z,
            blend_percent=blend_percent,
        )
        png_bytes = png_path.read_bytes()
        # Only scale down if RiverREM output is larger than target (never upscale).
        img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
        w, h = img.size
        if max(w, h) > target_size_px:
            ratio = target_size_px / max(w, h)
            new_size = (int(round(w * ratio)), int(round(h * ratio)))
            img = img.resize(new_size, Image.Resampling.LANCZOS)
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            return buf.getvalue()
        return png_bytes


@router.post("/rem/preview")
def rem_preview(request: REMPreviewRequest) -> Response:
    target = request.target_size_px or PREVIEW_MAX_PX
    target = max(256, min(PREVIEW_MAX_PX, target))
    print("REM preview started", request.bbox, "target_px=", target, flush=True)
    try:
        future = REM_EXECUTOR.submit(
            _rem_pipeline,
            tuple(request.bbox),
            target,
            request.colormap or "topo",
            request.hillshade_z or 5.0,
            request.blend_percent or 25.0,
        )
        png_bytes = future.result(timeout=300)
        print("REM preview completed", flush=True)
    except FuturesTimeoutError:
        LOGGER.warning("REM preview timed out after 5 minutes")
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="REM generation timed out after 5 minutes. Try a smaller area (e.g. Small AOI or a smaller river preset).",
        )
    except RuntimeError as e:
        LOGGER.warning("REM preview failed: %s", e)
        if "OPENTOPOGRAPHY_API_KEY" in str(e) or "RiverREM" in str(e):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(e),
            ) from e
        if "OpenTopography" in str(e):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=str(e),
            ) from e
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e
    except Exception as e:
        LOGGER.exception("REM preview failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        ) from e
    return Response(content=png_bytes, media_type="image/png")


@router.post("/rem/export")
def rem_export(request: REMExportRequest) -> Response:
    target = max(512, min(EXPORT_MAX_PX, request.target_size_px))
    try:
        future = REM_EXECUTOR.submit(
            _rem_pipeline,
            tuple(request.bbox),
            target,
            request.colormap or "topo",
            request.hillshade_z or 5.0,
            request.blend_percent or 25.0,
        )
        png_bytes = future.result(timeout=600)
    except FuturesTimeoutError:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="REM export timed out after 10 minutes. Try a smaller area.",
        )
    except RuntimeError as e:
        if "OPENTOPOGRAPHY_API_KEY" in str(e) or "RiverREM" in str(e):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(e),
            ) from e
        if "OpenTopography" in str(e):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=str(e),
            ) from e
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e
    except Exception as e:
        LOGGER.exception("REM export failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        ) from e
    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={"Content-Disposition": "attachment; filename=river-rem.png"},
    )


# USGS 3DEP Elevation Index: layer 1 = 1 m DEM footprint (lidar-derived), for "show where DEMs exist"
THREEDEP_INDEX_URL = "https://index.nationalmap.gov/arcgis/rest/services/3DEPElevationIndex/MapServer/1/query"


@router.get("/rem/3dep-coverage")
def rem_3dep_coverage(
    bbox: str,  # comma-separated: west,south,east,north (WGS84)
) -> Response:
    """Return GeoJSON of USGS 3DEP 1 m DEM coverage polygons intersecting the bbox (Dan Coe–style 'show where DEMs exist')."""
    try:
        parts = [float(x.strip()) for x in bbox.split(",")]
        if len(parts) != 4:
            raise ValueError("bbox must be west,south,east,north")
        west, south, east, north = parts
    except (ValueError, AttributeError) as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="bbox must be west,south,east,north (four comma-separated numbers)",
        ) from e
    params = {
        "geometryType": "esriGeometryEnvelope",
        "geometry": f'{{"xmin":{west},"ymin":{south},"xmax":{east},"ymax":{north}}}',
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "returnGeometry": "true",
        "outSR": "4326",
        "outFields": "*",
        "f": "geojson",
    }
    resp = requests.get(THREEDEP_INDEX_URL, params=params, timeout=30)
    resp.raise_for_status()
    return Response(content=resp.content, media_type="application/geo+json")
