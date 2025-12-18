# Earth Art MVP

Generate artful Sentinel-2 composites with FastAPI on the backend and a MapLibre-powered Next.js frontend.

## Project layout

```
backend/          # FastAPI app + processing pipeline
frontend/         # Next.js UI
.env.example      # Sample environment variables
```

## Backend

```bash
cd earth-art/backend
# Use Python 3.11/3.12 (concrete wheels are available via conda-forge; 3.13
# may still miss PyPI wheels for rasterio)
python3.11 -m venv .venv
source .venv/bin/activate

# macOS system deps (Intel/ARM):
#   brew install gdal geos proj
pip install -r requirements.txt   # pulls rasterio wheels from conda-forge for 3.13

uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Run tests:

```bash
pytest
```

## Frontend

```bash
cd earth-art/frontend
cp ../.env.example .env.local   # edit NEXT_PUBLIC_BACKEND_URL if needed
npm install
npm run dev
```

## Example API calls

Preview request:

```bash
curl -X POST http://localhost:8000/preview \
  -H "Content-Type: application/json" \
  -d '{
    "lat": 32.7157,
    "lon": -117.1611,
    "size_km": 10,
    "theme": "ndvi",
    "overlays": {"roads": true, "buildings": false}
  }'
```

Export request (PNG download):

```bash
curl -X POST http://localhost:8000/export \
  -H "Content-Type: application/json" \
  -d '{
    "lat": 32.7157,
    "lon": -117.1611,
    "size_km": 10,
    "theme": "geology",
    "target_size_px": 4096,
    "overlays": {"roads": true, "buildings": true},
    "watermark": "Earth Art"
  }' \
  --output geology.png
```

## Quick start (one-time)

- Install Python 3.11 (e.g., `brew install python@3.11`) and system libs: `brew install gdal geos proj`.
- Backend env:
  ```bash
  cd backend
  python3.11 -m venv .venv
  source .venv/bin/activate
  pip install -r requirements.txt
  ```
  In VS Code, select the interpreter at `backend/.venv/bin/python` so terminals/debugging use the same env.
- Frontend:
  ```bash
  cd ../frontend
  npm install
  cp ../.env.example .env.local   # set NEXT_PUBLIC_BACKEND_URL if different
  ```

## Daily/dev restart

- Backend: `cd backend && source .venv/bin/activate && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`
- Frontend (new terminal): `cd frontend && npm run dev`
- Visit http://localhost:3000 (frontend) and http://localhost:8000/health (backend check).
