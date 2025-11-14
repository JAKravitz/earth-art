import numpy as np
import pytest
import xarray as xr
from fastapi.testclient import TestClient

from app.main import app
from app.processing import fetch, overlays


class DummyAsset:
    def __init__(self, scale: float = 1.0, extras: dict | None = None):
        data = {"raster:bands": [{"scale": scale}]}
        if extras:
            data.update(extras)
        self.extra_fields = data
        self.href = "http://example.com/asset"


class DummyItem:
    def __init__(self, bands):
        self.id = "dummy-scene"
        self.collection_id = "sentinel-2-l2a"
        self.geometry = {
            "type": "Polygon",
            "coordinates": [[[-118, 32], [-118, 34], [-116, 34], [-116, 32], [-118, 32]]],
        }
        self.properties = {"proj:epsg": 32611, "datetime": "2024-01-01T00:00:00Z", "eo:cloud_cover": 5}
        self.assets = {band: DummyAsset(scale=0.0001) for band in bands}


def test_determine_utm_epsg_northern():
    assert fetch.determine_utm_epsg(32.7, -117.1) == 32611


def test_determine_utm_epsg_southern():
    assert fetch.determine_utm_epsg(-15.0, 130.0) == 32752


def test_resolve_assets_with_suffixes():
    bands = ["B02_10m", "B03_10m", "B04_10m"]
    dummy_item = DummyItem(bands)
    resolved, labels = fetch._resolve_assets(dummy_item, ["B04", "B03", "B02"])
    assert resolved == ["B04_10m", "B03_10m", "B02_10m"]
    assert labels == ["B04", "B03", "B02"]


def test_resolve_assets_via_common_name():
    dummy_item = DummyItem([])
    dummy_item.assets = {
        "vis_red": DummyAsset(extras={"eo:bands": [{"common_name": "red"}], "gsd": 10}),
        "vis_green": DummyAsset(extras={"eo:bands": [{"common_name": "green"}], "gsd": 10}),
        "vis_blue": DummyAsset(extras={"eo:bands": [{"common_name": "blue"}], "gsd": 10}),
    }
    resolved, labels = fetch._resolve_assets(dummy_item, ["B04", "B03", "B02"])
    assert resolved == ["vis_red", "vis_green", "vis_blue"]
    assert labels == ["B04", "B03", "B02"]


def test_resolve_assets_missing_band():
    dummy_item = DummyItem(["B04", "B03", "B02"])
    with pytest.raises(fetch.SceneValidationError):
        fetch._resolve_assets(dummy_item, ["B12"])


def test_required_bands_handles_new_themes():
    assert fetch.required_bands("truecolor") == ["B04", "B03", "B02"]
    assert fetch.required_bands("falseveg") == ["B08", "B04", "B03"]
    assert fetch.required_bands("decorr") == ["B12", "B08", "B04"]
    assert fetch.required_bands("index_triplet") == ["B02", "B03", "B04", "B08", "B11", "B12"]


def test_load_scene_stack_shapes(monkeypatch):
    bands = ["B04", "B03", "B02"]
    dummy_item = DummyItem(bands)
    bbox = (-117.5, 32.5, -116.5, 33.5)

    def fake_stack(*args, **kwargs):
        requested = kwargs["assets"]
        data = np.ones((1, len(requested), 2, 2), dtype="float32")
        coords = {"time": [0], "band": requested, "y": np.arange(2), "x": np.arange(2)}
        return xr.DataArray(data, dims=("time", "band", "y", "x"), coords=coords)

    monkeypatch.setattr(fetch.stackstac, "stack", fake_stack)

    stack, epsg = fetch.load_scene_stack(
        dummy_item, bbox, bands, 256, bands, fetch.get_resampling("bilinear")
    )
    assert stack.shape == (len(bands), 2, 2)
    assert epsg == 32611
    assert set(stack.coords["band"].values.tolist()) == set(bands)


def test_preview_endpoint_returns_png(monkeypatch):
    client = TestClient(app)
    bands = ["B04", "B03", "B02"]
    dummy_item = DummyItem(bands)
    stack = xr.DataArray(
        np.random.rand(len(bands), 16, 16).astype("float32"),
        dims=("band", "y", "x"),
        coords={"band": bands, "y": np.arange(16), "x": np.arange(16)},
    )
    selection = fetch.SceneSelection(item=dummy_item, bbox=(-117.2, 32.6, -117.1, 32.7))

    def fake_fetch(*args, **kwargs):
        return stack, selection, "EPSG:32611"

    monkeypatch.setattr(fetch, "fetch_raster_stack", fake_fetch)
    monkeypatch.setattr(overlays, "fetch_osm_features", lambda *args, **kwargs: {})

    payload = {
        "lat": 32.7157,
        "lon": -117.1611,
        "size_km": 10,
        "theme": "true",
        "overlays": {"roads": False, "buildings": False},
    }
    response = client.post("/preview", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["png_base64"]
    assert data["scene_metadata"]["id"] == "dummy-scene"

def test_resolve_assets_yields_resampling_enum(monkeypatch):
    dummy_item = DummyItem(["B04", "B03", "B02"])
    bbox = (-117.5, 32.5, -116.5, 33.5)

    called = {}

    def fake_stack(*args, **kwargs):
        called["resampling"] = kwargs["resampling"]
        data = np.ones((1, len(kwargs["assets"]), 2, 2), dtype="float32")
        coords = {"time": [0], "band": kwargs["assets"], "y": np.arange(2), "x": np.arange(2)}
        return xr.DataArray(data, dims=("time", "band", "y", "x"), coords=coords)

    monkeypatch.setattr(fetch.stackstac, "stack", fake_stack)

    asset_ids, labels = fetch._resolve_assets(dummy_item, ["B04", "B03", "B02"])
    stack, epsg = fetch.load_scene_stack(
        dummy_item,
        bbox,
        asset_ids,
        256,
        labels,
        fetch.get_resampling("nearest"),
    )
    assert called["resampling"].__class__.__name__ == "Resampling"
    assert called["resampling"].name == "nearest"
    assert stack.shape == (3, 2, 2)


def test_get_resampling_env(monkeypatch):
    assert fetch.get_resampling("nearest").name == "nearest"
    assert fetch.get_resampling("BILINEAR").name == "bilinear"
    assert fetch.get_resampling("unknown").name == "bilinear"
