import numpy as np
import xarray as xr
import dask.array as da

from app.processing import render


def test_as_rgb_uint8_from_uint8():
    arr = np.random.randint(0, 255, (10, 12, 3), dtype=np.uint8)
    rgb = render.as_rgb_uint8(arr, assume_01=False)
    assert rgb.dtype == np.uint8
    assert rgb.shape == (10, 12, 3)


def test_to_image_from_xarray():
    data = xr.DataArray(np.random.rand(3, 8, 8).astype("float32"), dims=("band", "y", "x"))
    image = render.to_image(data)
    assert image.size == (8, 8)


def test_single_band_expansion():
    data = np.ones((1, 5, 5), dtype="float32")
    image = render.to_image(data)
    assert image.mode == "RGB"
    assert image.size == (5, 5)


def test_dask_array_render():
    data = da.random.random((3, 6, 6), chunks=(3, 6, 6))
    image = render.to_image(data)
    assert image.size == (6, 6)


def test_render_many_bands_safety():
    data = np.random.rand(18, 32, 32).astype("float32")
    image = render.to_image(data)
    assert image.size == (32, 32)
