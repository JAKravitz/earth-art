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
    def __init__(
        self,
        bands,
        scene_id: str = "dummy-scene",
        datatake: str = "2024-01-01T00:00:00Z",
        geometry: dict | None = None,
    ):
        self.id = scene_id
        self.collection_id = "sentinel-2-l2a"
        self.geometry = geometry or {
            "type": "Polygon",
            "coordinates": [[[-118, 32], [-118, 34], [-116, 34], [-116, 32], [-118, 32]]],
        }
        self.properties = {
            "proj:epsg": 32611,
            "datetime": datatake,
            "eo:cloud_cover": 5,
            "sentinel:datatake_start_time": datatake,
        }
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


def test_find_scenes_prioritizes_shared_datatake(monkeypatch):
    aoi = (-117.5, 32.5, -116.5, 33.5)
    scene_a = DummyItem(["B04"], scene_id="scene-a", datatake="2024-01-01T10:00:00Z")
    scene_b = DummyItem(["B04"], scene_id="scene-b", datatake="2024-01-01T10:00:00Z")
    scene_c = DummyItem(["B04"], scene_id="scene-c", datatake="2024-01-02T10:00:00Z")

    class DummySearch:
        def __init__(self, items):
            self._items = items

        def items(self):
            return self._items

    class DummyClient:
        def __init__(self, items):
            self._items = items

        def search(self, **kwargs):
            return DummySearch(self._items)

    monkeypatch.setattr(fetch.Client, "open", lambda *args, **kwargs: DummyClient([scene_a, scene_b, scene_c]))

    results = fetch.find_scenes_for_aoi(aoi_bounds=aoi, max_scenes=3)
    assert [selection.item.id for selection in results] == ["scene-a", "scene-b"]


def test_find_scenes_falls_back_to_mixing_datatakes(monkeypatch):
    aoi = (-117.5, 32.5, -116.5, 33.5)
    # Each scene is a different datatake; we still want to mosaic across them
    # instead of returning only the most recent single scene.
    scene_a = DummyItem(["B04"], scene_id="scene-a", datatake="2024-01-03T10:00:00Z")
    scene_b = DummyItem(["B04"], scene_id="scene-b", datatake="2024-01-02T10:00:00Z")
    scene_c = DummyItem(["B04"], scene_id="scene-c", datatake="2024-01-01T10:00:00Z")

    class DummySearch:
        def __init__(self, items):
            self._items = items

        def items(self):
            return self._items

    class DummyClient:
        def __init__(self, items):
            self._items = items

        def search(self, **kwargs):
            return DummySearch(self._items)

    monkeypatch.setattr(fetch.Client, "open", lambda *args, **kwargs: DummyClient([scene_a, scene_b, scene_c]))

    results = fetch.find_scenes_for_aoi(aoi_bounds=aoi, max_scenes=3)
    assert [selection.item.id for selection in results] == ["scene-a", "scene-b", "scene-c"]
    assert len(results) <= fetch.MOSAIC_MAX_SCENES


def test_find_scenes_accumulates_across_windows(monkeypatch):
    aoi = (0.0, 0.0, 2.0, 1.0)

    def make_geom(xmin: float, xmax: float):
        return {"type": "Polygon", "coordinates": [[[xmin, 0.0], [xmin, 1.0], [xmax, 1.0], [xmax, 0.0], [xmin, 0.0]]]}

    left = DummyItem(["B04"], scene_id="left", datatake="2024-01-03T10:00:00Z", geometry=make_geom(0.0, 1.0))
    right = DummyItem(["B04"], scene_id="right", datatake="2023-12-30T10:00:00Z", geometry=make_geom(1.0, 2.0))

    class DummySearch:
        def __init__(self, items):
            self._items = items

        def items(self):
            return self._items

    class DummyClient:
        def __init__(self):
            self.calls = 0

        def search(self, **kwargs):
            self.calls += 1
            return DummySearch([left] if self.calls == 1 else [right])

    monkeypatch.setattr(fetch.Client, "open", lambda *args, **kwargs: DummyClient())

    results = fetch.find_scenes_for_aoi(aoi_bounds=aoi, max_scenes=4)
    assert sorted(sel.item.id for sel in results) == ["left", "right"]


def test_find_scenes_stops_when_coverage_reached(monkeypatch):
    aoi = (0.0, 0.0, 2.0, 1.0)

    def make_geom(xmin: float, xmax: float):
        return {"type": "Polygon", "coordinates": [[[xmin, 0.0], [xmin, 1.0], [xmax, 1.0], [xmax, 0.0], [xmin, 0.0]]]}

    left = DummyItem(["B04"], scene_id="left", datatake="2024-01-03T10:00:00Z", geometry=make_geom(0.0, 1.0))
    right = DummyItem(["B04"], scene_id="right", datatake="2024-01-02T10:00:00Z", geometry=make_geom(1.0, 2.0))
    tiny_overlap = DummyItem(["B04"], scene_id="tiny", datatake="2024-01-01T10:00:00Z", geometry=make_geom(0.9, 1.1))

    class DummySearch:
        def __init__(self, items):
            self._items = items

        def items(self):
            return self._items

    class DummyClient:
        def search(self, **kwargs):
            return DummySearch([left, right, tiny_overlap])

    monkeypatch.setattr(fetch.Client, "open", lambda *args, **kwargs: DummyClient())

    results = fetch.find_scenes_for_aoi(aoi_bounds=aoi, max_scenes=4)
    ids = [sel.item.id for sel in results]
    assert "left" in ids and "right" in ids
    assert "tiny" not in ids  # coverage target met without extra tiles
