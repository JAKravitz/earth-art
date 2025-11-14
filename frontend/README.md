# Earth Art Frontend

Next.js + MapLibre single-page app that talks to the FastAPI backend.

## Setup

```bash
cd earth-art/frontend
npm install
```

Create a `.env.local` file pointing to the backend:

```
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
```

## Development

```bash
npm run dev
```

## Production build

```bash
npm run build
npm start
```
