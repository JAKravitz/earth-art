# Earth Art Backend

FastAPI service that builds Sentinel-2 composites, optional OSM overlays, and exports ready-to-share artwork.

## Prerequisites

- Python 3.11/3.12 (recommended). Python 3.13 may miss PyPI rasterio wheels;
  the requirement file now pulls from conda-forge to fill the gap.
- GDAL/GEOS/PROJ system libraries (see Dockerfile for apt packages)
  - macOS (Intel/ARM): `brew install gdal geos proj`

## Setup

```bash
cd earth-art/backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Development

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Testing

```bash
pytest
```

## Environment variables

- `STAC_API_URL` – defaults to `https://earth-search.aws.element84.com/v1`
- `PREVIEW_MAX_PX` – maximum dimension for preview renders (default `2048`)
- `MOSAIC_MAX_CLOUD_PCT` – when building multi-scene mosaics, only consider scenes with `eo:cloud_cover` below this percentage (default `20`). Set lower (e.g. `5`) for stricter cloud-free imagery; set `0` to use the same limits as the search windows (5% then 20%).
- `PREVIEW_STACK_CACHE_TTL_SEC` – seconds to keep the filter-preview raster stack in memory (default `300`).
- `STACK_CHUNKSIZE` – chunk size for stackstac/dask (default `2048`). Keep at 2048 for reliable COG reads; smaller values can cause many tiny requests and timeouts.
- `MOSAIC_HARMONIZE_STRIDE` – stride when sampling for harmonization (default `8`). Larger = faster.
- `MOSAIC_HARMONIZE_DOWNSAMPLE` – downsample factor for harmonization (default `2`). Gains computed on 1/N resolution, applied at full res.
