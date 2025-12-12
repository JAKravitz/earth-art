"""Rendering helpers for turning spectral composites into PNGs."""
from __future__ import annotations

import numpy as np
import xarray as xr
from PIL import Image, ImageColor, ImageDraw, ImageFont, ImageEnhance


def make_solid_canvas(height: int, width: int, hex_color: str | None) -> np.ndarray:
    r, g, b = ImageColor.getrgb(hex_color or "#0e0e10")
    canvas = np.zeros((3, height, width), dtype="float32")
    canvas[0, :, :] = r / 255.0
    canvas[1, :, :] = g / 255.0
    canvas[2, :, :] = b / 255.0
    return canvas


def _to_numpy(data):
    if isinstance(data, xr.DataArray):
        data = data.transpose("band", "y", "x", missing_dims="ignore")
        data = data.data
    if hasattr(data, "compute"):
        data = data.compute()
    return np.asarray(data)


def _to_band_first(arr: np.ndarray) -> np.ndarray:
    arr = np.asarray(arr)
    if arr.ndim == 2:
        arr = arr[None, ...]
    elif arr.ndim == 3:
        first, last = arr.shape[0], arr.shape[-1]
        if first in (1, 2, 3):
            pass
        elif last in (1, 2, 3):
            arr = np.transpose(arr, (2, 0, 1))
        else:
            # assume band-first
            pass
    else:
        raise ValueError(f"Unsupported array rank {arr.ndim}")

    if arr.shape[0] == 1:
        arr = np.repeat(arr, 3, axis=0)
    elif arr.shape[0] == 2:
        third = ((arr[0] + arr[1]) / 2)[None, ...]
        arr = np.concatenate([arr, third], axis=0)
    elif arr.shape[0] > 3:
        arr = arr[:3]
    return arr


def apply_percentile_stretch(data, lower: float = 2.0, upper: float = 98.0) -> np.ndarray:
    arr = _to_numpy(data)
    arr = _to_band_first(arr.astype("float32"))
    stride_y = max(1, arr.shape[1] // 1024)
    stride_x = max(1, arr.shape[2] // 1024)
    sample = arr[:, ::stride_y, ::stride_x]
    lo = np.nanpercentile(sample, lower, axis=(1, 2), keepdims=True)
    hi = np.nanpercentile(sample, upper, axis=(1, 2), keepdims=True)
    hi = np.where(hi - lo == 0, lo + 1e-6, hi)
    stretched = (arr - lo) / (hi - lo)
    stretched = np.clip(stretched, 0, 1)
    return np.nan_to_num(stretched, nan=0.0, posinf=1.0, neginf=0.0)


def apply_gamma(data: np.ndarray, gamma: float) -> np.ndarray:
    gamma = max(0.1, gamma)
    return np.power(np.clip(data, 0, 1), 1.0 / gamma)


def as_rgb_uint8(data, *, assume_01: bool = False) -> np.ndarray:
    arr = _to_numpy(data)
    arr = np.nan_to_num(arr, nan=0.0)
    arr = _to_band_first(arr.astype("float32"))

    if not assume_01:
        band_min = arr.min(axis=(1, 2), keepdims=True)
        band_max = arr.max(axis=(1, 2), keepdims=True)
        denom = band_max - band_min
        denom[denom == 0] = 1
        arr = (arr - band_min) / denom
    else:
        arr = np.clip(arr, 0, 1)

    rgb = np.transpose(arr, (1, 2, 0))
    rgb = np.clip(rgb, 0, 1)
    return (rgb * 255).round().astype("uint8")


def to_image(data, gamma: float = 1.0, apply_stretch: bool = True) -> Image.Image:
    if apply_stretch:
        stretched = apply_percentile_stretch(data)
        adjusted = apply_gamma(stretched, gamma)
        rgb = as_rgb_uint8(adjusted, assume_01=True)
    else:
        arr = _to_numpy(data)
        arr = np.nan_to_num(arr, nan=0.0)
        arr = _to_band_first(arr.astype("float32"))
        arr = np.clip(arr, 0, 1)
        if gamma != 1.0:
            arr = apply_gamma(arr, gamma)
        rgb = as_rgb_uint8(arr, assume_01=True)
    return Image.fromarray(rgb)


def resize_image(image: Image.Image, max_side: int) -> Image.Image:
    if max(image.size) <= max_side:
        return image
    ratio = max_side / max(image.size)
    new_size = (int(image.width * ratio), int(image.height * ratio))
    return image.resize(new_size, Image.LANCZOS)


def scale_to_max(image: Image.Image, max_side: int) -> Image.Image:
    if max(image.size) == max_side:
        return image
    ratio = max_side / max(image.size)
    new_size = (int(round(image.width * ratio)), int(round(image.height * ratio)))
    return image.resize(new_size, Image.LANCZOS)


def add_watermark(image: Image.Image, text: str) -> Image.Image:
    if not text:
        return image
    drawable = ImageDraw.Draw(image)
    font = ImageFont.load_default()
    margin = 8
    text_width, text_height = drawable.textsize(text, font=font)
    x = image.width - text_width - margin
    y = image.height - text_height - margin
    drawable.rectangle(
        [(x - 4, y - 2), (x + text_width + 4, y + text_height + 2)],
        fill=(0, 0, 0, 120),
    )
    drawable.text((x, y), text, font=font, fill=(255, 255, 255, 200))
    return image


def encode_png(image: Image.Image) -> Tuple[bytes, str]:
    import base64
    import io

    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    raw = buffer.getvalue()
    encoded = base64.b64encode(raw).decode("utf-8")
    return raw, encoded


def apply_enhancements(image: Image.Image, adjustments: dict | None) -> Image.Image:
    if not adjustments:
        return image
    brightness = float(adjustments.get("brightness", 1.0))
    contrast = float(adjustments.get("contrast", 1.0))
    saturation = float(adjustments.get("saturation", 1.0))
    img = image
    if brightness != 1.0:
        img = ImageEnhance.Brightness(img).enhance(brightness)
    if contrast != 1.0:
        img = ImageEnhance.Contrast(img).enhance(contrast)
    if saturation != 1.0:
        img = ImageEnhance.Color(img).enhance(saturation)
    return img
