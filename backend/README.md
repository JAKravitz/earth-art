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

### River REM (Water product)

**About REMs.** A Relative Elevation Model (REM), or height-above-river (HAR) raster, detrends the DEM so the baseline (0 m) follows the water surface instead of sea level; elevations then show relative height above the river. REMs help visualize meander scars, terraces, and floodplain features. Methods used here follow the IDW/centerline approach described by [Olson and others (2014)](https://www.sciencebase.gov/catalog/item/54c4e1b2e4b043905e018644) and the [Dan Coe Carto](https://dancoecarto.com/) QGIS tutorials ([IDW method](https://dancoecarto.com/creating-rems-in-qgis-the-idw-method), [cross-section method](https://dancoecarto.com/creating-rems-in-qgis-the-cross-section-method)). Best results: meandering rivers and moderate gradient; accuracy can be reduced by steep gradients, dams, waterfalls, tidal areas, braided channels, or mosaicked DEMs from different dates.

The REM endpoints (`POST /rem/preview`, `POST /rem/export`) use [RiverREM](https://github.com/OpenTopography/RiverREM) and the OpenTopography Global DEM API.

- **RiverREM** – Install via conda (not PyPI). RiverREM pulls in Shapely 2.1.x; the main `requirements.txt` pins OSMnx 1.9.4 which requires Shapely &lt;2.1, so use a **separate conda env** and `requirements-rem.txt` for REM:

  ```bash
  cd backend
  conda create -n earth-art-rem python=3.11
  conda activate earth-art-rem
  conda install -c conda-forge riverrem
  pip install -r requirements-rem.txt
  ```

  `requirements-rem.txt` pins `osmnx>=1.3,<2` (RiverREM uses APIs removed in OSMnx 2). RiverREM also requires **GDAL ≥ 3.7** (for `GDT_Int8`). If you see `AttributeError: ... 'GDT_Int8'`, run:

  ```bash
  conda activate earth-art-rem
  conda install -c conda-forge "gdal>=3.7,<3.9"
  ```

  Then run the backend with this env when using REM.
- **DEM source** – OpenTopography Global DEM API. Register at [opentopography.org](https://opentopography.org) and add your API key to the backend environment.
- `OPENTOPOGRAPHY_API_KEY` – (required for REM) Your OpenTopography API key. Without it, REM preview/export return 503.
- `REM_DEM_TYPE` – OpenTopography Global DEM dataset (default `SRTMGL3`). Options: `SRTMGL3` (90m), `SRTMGL1` (30m), `COP30` (Copernicus 30m), `COP90` (Copernicus 90m). Area limits apply per dataset. For a survey of DEM sources see [Awesome-DEM](https://github.com/DahnJ/Awesome-DEM).
- `REM_PREVIEW_MAX_PX` – max preview dimension (default `1024`).
- `REM_EXPORT_MAX_PX` – max export dimension (default `4096`).
- **3DEP coverage** – `GET /rem/3dep-coverage?bbox=west,south,east,north` returns GeoJSON of USGS 3DEP 1 m DEM footprints in that bbox (for a “show where high-res DEMs exist” map layer, as in the [Dan Coe 3DEP tutorial](https://dancoecarto.com/downloading-and-preparing-lidar-dems-for-rem-processing)).
