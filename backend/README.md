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
