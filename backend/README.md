# Earth Art Backend

FastAPI service that builds Sentinel-2 composites, optional OSM overlays, and exports ready-to-share artwork.

## Prerequisites

- Python 3.11+
- GDAL/GEOS libraries (see Dockerfile for apt packages)

## Setup

```bash
cd earth-art/backend
python -m venv .venv
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
- `PREVIEW_MAX_PX` – maximum dimension for preview renders (default `1024`)
