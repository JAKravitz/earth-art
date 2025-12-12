export type ThemeId = "earth-science" | "urban";

export type FilterStyleType = "PCA" | "MNF" | "FalseColor" | "DecorrelatedStretch" | "UrbanOverlay" | "Custom";

export interface ThemeConfig {
  id: ThemeId;
  name: string;
  description: string;
}

export interface FilterConfig {
  id: string;
  themeId: ThemeId;
  name: string;
  description: string;
  styleType: FilterStyleType;
  params: Record<string, unknown>;
}

export const THEMES: ThemeConfig[] = [
  {
    id: "earth-science",
    name: "Earth Science",
    description: "Spectral, geology, vegetation, and coastal looks derived from Earth observation data.",
  },
  {
    id: "urban",
    name: "Urban & Social",
    description: "Urban form, street networks, and human-built structure.",
  },
];

export const FILTERS: FilterConfig[] = [
  {
    id: "true-color",
    themeId: "earth-science",
    name: "True Color",
    styleType: "FalseColor",
    description: "Natural RGB baseline with balanced stretch and neutral white balance.",
    params: {
      rgbBands: ["B04", "B03", "B02"],
      lower: 2.0,
      upper: 98.0,
      whiteBalance: true,
      saturation: 1.0,
      gamma: 1.0,
    },
  },
  {
    id: "aurora-pca",
    themeId: "earth-science",
    name: "Aurora PCA",
    styleType: "PCA",
    description: "Vivid PCA-based composite, great for coasts, deltas, and mountains.",
    params: {
      inputBands: ["B02", "B03", "B04", "B08"],
      componentsToRgb: [0, 1, 2],
      method: "pca",
      palette: "neon",
    },
  },
  {
    id: "infra-bloom",
    themeId: "earth-science",
    name: "Infra Bloom",
    styleType: "FalseColor",
    description: "Classic NIR false color: pink vegetation and glowing landscapes.",
    params: {
      rgbBands: ["B08", "B04", "B02"],
      gamma: 0.82,
    },
  },
  {
    id: "basalt-glow",
    themeId: "earth-science",
    name: "Basalt Glow",
    styleType: "DecorrelatedStretch",
    description: "SWIR-heavy geology look for mountains, deserts, and lava fields.",
    params: {
      inputBands: ["B12", "B11", "B08"],
      palette: "warm",
      stretch: "vivid",
    },
  },
  {
    id: "neon-delta",
    themeId: "earth-science",
    name: "Neon Delta",
    styleType: "DecorrelatedStretch",
    description: "Neon, decorrelated stretch look for coasts and river deltas.",
    params: {
      inputBands: ["B03", "B08", "B11"],
      method: "decorrelation",
      palette: "cool",
      stretch: "vivid",
    },
  },
  {
    id: "desert-veins",
    themeId: "earth-science",
    name: "Desert Veins",
    styleType: "Custom",
    description: "Warm, painterly dryland textures emphasizing drainage and dunes.",
    params: {
      formula: "desert-veins-v1",
      components: { ndvi: { num: "B08", den: "B04" }, swir1: "B11", swir2: "B12" },
      stretch: "medium",
      palette: "warm-earth",
    },
  },
  {
    id: "emerald-canopy",
    themeId: "earth-science",
    name: "Emerald Canopy",
    styleType: "MNF",
    description: "Dense vegetation punch-up with teal shadows and sunlit highlights.",
    params: {
      palette: "cool",
    },
  },
  {
    id: "city-veins",
    themeId: "urban",
    name: "City Veins",
    styleType: "UrbanOverlay",
    description: "Dark base with glowing road networks – cities as neural circuits.",
    params: {
      base: { type: "solid", color: "#0b1020", brightness: 0.45 },
      roads: { enabled: true, color: "#00F5FF", width: 2.0, glow: true },
      buildings: { enabled: false },
      edges: { enabled: false },
    },
  },
  {
    id: "infra-grid",
    themeId: "urban",
    name: "Infra Grid",
    styleType: "FalseColor",
    description: "Warm false-color urban density with subtle road/built overlays.",
    params: {
      base: { type: "solid", color: "#1a0f1f", brightness: 0.55 },
      roads: { enabled: true, color: "#ffd166", width: 1.3, glow: false },
      buildings: { enabled: true, color: "#ffffff", width: 0.8, opacity: 0.45, fill_opacity: 0.08 },
    },
  },
];

export function getFiltersForTheme(themeId: ThemeId): FilterConfig[] {
  return FILTERS.filter((f) => f.themeId === themeId);
}

export function getFilterById(id: string): FilterConfig | undefined {
  return FILTERS.find((f) => f.id === id);
}
