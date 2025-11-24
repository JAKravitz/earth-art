from __future__ import annotations

from enum import Enum
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field, PositiveInt, field_validator

ThemeLiteral = Literal[
    "true",
    "truecolor",
    "false_veg",
    "falseveg",
    "ndvi",
    "pca",
    "geology",
    "decorr",
    "nmf",
    "index_triplet",
]


class OverlayOptions(BaseModel):
    roads: bool = Field(default=False, description="Render OpenStreetMap roads overlay")
    buildings: bool = Field(default=False, description="Render OpenStreetMap buildings overlay")

    def any_enabled(self) -> bool:
        return self.roads or self.buildings


class OverlayStyle(BaseModel):
    color: Optional[str] = None
    width: Optional[float] = None
    opacity: Optional[float] = None
    fill_opacity: Optional[float] = None


class OverlayStyles(BaseModel):
    roads: Optional[OverlayStyle] = None
    buildings: Optional[OverlayStyle] = None


class BackgroundOptions(BaseModel):
    mode: Literal["imagery", "solid"] = "imagery"
    color: Optional[str] = "#0e0e10"


class DateRange(BaseModel):
    start: Optional[str] = Field(default=None, description="ISO date string for the search start")
    end: Optional[str] = Field(default=None, description="ISO date string for the search end")

    @field_validator("start", "end")
    @classmethod
    def validate_date(cls, value: Optional[str]) -> Optional[str]:
        if value in (None, ""):
            return None
        # pydantic will raise if invalid isoformat
        try:
            from datetime import datetime

            datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as exc:  # pragma: no cover - defensive
            raise ValueError("date must be ISO8601") from exc
        return value

    def to_timerange(self) -> Optional[str]:
        if self.start and self.end:
            return f"{self.start}/{self.end}"
        if self.start:
            return f"{self.start}/.."
        if self.end:
            return f"../{self.end}"
        return None


class PreviewRequest(BaseModel):
    lat: float = Field(..., ge=-90.0, le=90.0)
    lon: float = Field(..., ge=-180.0, le=180.0)
    size_km: float = Field(10.0, ge=1.0, le=50.0)
    theme: ThemeLiteral = "true"
    overlays: OverlayOptions | Dict[str, bool] = Field(default_factory=OverlayOptions)
    date_range: Optional[DateRange] = None
    pcaScheme: Optional[str] = "vivid"
    palette: Optional[Literal["vivid", "warm", "cool", "neutral", "random"]] = "vivid"
    indexPack: Optional[Literal["veg", "aqua", "urban"]] = "veg"
    overlayStyles: Optional[OverlayStyles] = None
    background: BackgroundOptions = Field(default_factory=BackgroundOptions)

    @field_validator("overlays", mode="before")
    @classmethod
    def _coerce_overlays(cls, value: OverlayOptions | Dict[str, bool]) -> OverlayOptions:
        if isinstance(value, OverlayOptions):
            return value
        if isinstance(value, dict):
            return OverlayOptions(**value)
        return value


class ExportRequest(PreviewRequest):
    target_size_px: PositiveInt = Field(4096, le=8192)
    watermark: Optional[str] = Field(default=None, max_length=64)


class SceneMetadata(BaseModel):
    id: str
    datetime: str
    cloud_coverage: float
    collection: Optional[str] = None
    assets: Dict[str, str] = Field(default_factory=dict)


class PreviewResponse(BaseModel):
    png_base64: str
    bbox: List[float]
    scene_metadata: SceneMetadata


FilterStyleLiteral = Literal["PCA", "MNF", "FalseColor", "DecorrelatedStretch", "UrbanOverlay", "Custom"]


class FilterSpec(BaseModel):
    id: str
    styleType: FilterStyleLiteral
    params: Dict[str, object] = Field(default_factory=dict)


class BatchPreviewRequest(BaseModel):
    lat: float = Field(..., ge=-90.0, le=90.0)
    lon: float = Field(..., ge=-180.0, le=180.0)
    size_km: float = Field(10.0, ge=1.0, le=100.0)
    aoi_bounds: Optional[List[float]] = Field(default=None, description="Optional AOI bbox [w, s, e, n]")
    themeId: Literal["earth-science", "urban"] = "earth-science"
    filters: List[FilterSpec]
    preview: bool = True
    target_size_px: PositiveInt = Field(default=768, le=2048)
    date_range: Optional[DateRange] = None


class BatchPreviewItem(BaseModel):
    id: str
    png_base64: str
    bbox: List[float]
    scene_metadata: Optional[SceneMetadata] = None


class BatchPreviewResponse(BaseModel):
    results: List[BatchPreviewItem]


class ExportFilterRequest(BaseModel):
    lat: float = Field(..., ge=-90.0, le=90.0)
    lon: float = Field(..., ge=-180.0, le=180.0)
    size_km: float = Field(10.0, ge=1.0, le=100.0)
    aoi_bounds: Optional[List[float]] = None
    filter: FilterSpec
    target_size_px: PositiveInt = Field(4096, le=8192)
    watermark: Optional[str] = Field(default=None, max_length=64)
    adjustments: Optional[Dict[str, float]] = None
