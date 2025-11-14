import numpy as np
import xarray as xr
from types import SimpleNamespace

from app.processing import compose


def build_stack() -> xr.DataArray:
    bands = ["B02", "B03", "B04", "B08", "B11", "B12"]
    y, x = 10, 12
    base = np.linspace(0, 1, num=y * x, dtype="float32").reshape(y, x)
    data = np.stack([(base * (i + 1)) + i for i in range(len(bands))])
    return xr.DataArray(data, dims=("band", "y", "x"), coords={"band": bands})


def test_true_color_channels():
    stack = build_stack()
    rgb = compose.compose_true_color(stack)
    assert rgb.shape == (3, 10, 12)
    # verify order B4,B3,B2
    assert np.allclose(rgb[0], stack.sel(band="B04").data)
    assert np.allclose(rgb[1], stack.sel(band="B03").data)
    assert np.allclose(rgb[2], stack.sel(band="B02").data)


def test_ndvi_gradient():
    stack = build_stack()
    rgb = compose.compose_ndvi(stack)
    assert rgb.shape == (3, 10, 12)
    assert rgb.min() >= 0
    assert rgb.max() <= 1


def test_pca_normalized():
    stack = build_stack()
    rgb = compose.compose_pca(stack)
    assert rgb.shape == (3, 10, 12)
    assert rgb.max() <= 1.0
    assert rgb.min() >= 0.0
    assert np.any(rgb > 0)


def test_pca_handles_nans():
    stack = build_stack().astype("float32")
    stack = stack.where(stack.coords["band"] != "B02", np.nan)
    rgb = compose.compose_pca(stack)
    assert rgb.shape == (3, 10, 12)
    assert np.isfinite(rgb).all()
    assert rgb.max() <= 1.0
    assert rgb.min() >= 0.0
    assert np.all((rgb == 0) | (rgb > 0))


def test_pca_returns_three_bands_with_dask():
    data = np.random.rand(6, 64, 64).astype("float32")
    bands = ["B02", "B03", "B04", "B08", "B11", "B12"]
    stack = xr.DataArray(data, dims=("band", "y", "x"), coords={"band": bands})
    stack = stack.chunk({"y": 32, "x": 32})
    rgb = compose.compose_pca(stack)
    assert rgb.shape == (3, 64, 64)
    assert rgb.dtype == np.float32


def test_decorr_theme_uses_palette():
    stack = build_stack()
    req = SimpleNamespace(palette="cool", indexPack="veg", pcaScheme="warm")
    rgb = compose.build_theme(stack, "decorr", request=req)
    assert rgb.shape == (3, 10, 12)
    assert np.isfinite(rgb).all()


def test_nmf_theme_returns_rgb():
    stack = build_stack()
    req = SimpleNamespace(palette="warm", indexPack="veg", pcaScheme="vivid")
    rgb = compose.build_theme(stack, "nmf", request=req)
    assert rgb.shape == (3, 10, 12)
    assert np.isfinite(rgb).all()


def test_index_triplet_pack_switch():
    stack = build_stack()
    req = SimpleNamespace(palette="neutral", indexPack="urban", pcaScheme="vivid")
    rgb = compose.build_theme(stack, "index_triplet", request=req)
    assert rgb.shape == (3, 10, 12)
    assert np.isfinite(rgb).all()
