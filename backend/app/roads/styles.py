from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RoadStyle:
    id: str
    name: str
    background: str
    major_color: str
    minor_color: str
    major_width: float
    minor_width: float
    major_opacity: float = 1.0
    minor_opacity: float = 1.0
    glow_color: str | None = None
    glow_width: float = 0.0
    glow_blur: float = 0.0
    water_color: str | None = None
    grain: bool = False
    secondary_color: str | None = None
    secondary_opacity: float = 0.35


ROAD_STYLES: dict[str, RoadStyle] = {
    "blueprint": RoadStyle(
        id="blueprint",
        name="Blueprint Roads",
        background="#0b1a33",
        major_color="#f7d66c",
        minor_color="#d9b94a",
        major_width=2.8,
        minor_width=1.2,
        major_opacity=0.95,
        minor_opacity=0.8,
        water_color="#f5f4ef",
    ),
    "gold": RoadStyle(
        id="gold",
        name="Gold on Black",
        background="#050505",
        major_color="#f1b45a",
        minor_color="#d18c3a",
        major_width=2.6,
        minor_width=1.0,
        major_opacity=0.95,
        minor_opacity=0.8,
        glow_color="#f5c671",
        glow_width=7.0,
        glow_blur=5.0,
    ),
    "ink": RoadStyle(
        id="ink",
        name="Ink Atlas",
        background="#f5f1e8",
        major_color="#1d1d1d",
        minor_color="#5d5d5d",
        major_width=2.3,
        minor_width=0.9,
        major_opacity=0.95,
        minor_opacity=0.7,
        grain=True,
        secondary_color="#b9b0a6",
        secondary_opacity=0.35,
    ),
}


def get_style(style_id: str) -> RoadStyle:
    if style_id not in ROAD_STYLES:
        raise KeyError(f"Unknown road style: {style_id}")
    return ROAD_STYLES[style_id]
