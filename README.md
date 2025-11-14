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
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
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
