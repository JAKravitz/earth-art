export type ProductPresetId = "square" | "poster-landscape" | "poster-portrait" | "panorama";

export interface ProductPreset {
  id: ProductPresetId;
  name: string;
  description?: string;
  aspectRatio: number; // width / height
  suggestedWidthKm: {
    "earth-science": number;
    urban: number;
  };
}

export const AOI_PRESETS: ProductPreset[] = [
  {
    id: "square",
    name: "Square Artwork",
    aspectRatio: 1,
    suggestedWidthKm: { "earth-science": 35, urban: 15 },
    description: "Balanced square canvas for bold compositions.",
  },
  {
    id: "poster-landscape",
    name: "Classic Poster (Landscape)",
    aspectRatio: 3 / 2,
    suggestedWidthKm: { "earth-science": 60, urban: 24 },
    description: "Wide poster ratio for sweeping scenes.",
  },
  {
    id: "poster-portrait",
    name: "Classic Poster (Portrait)",
    aspectRatio: 2 / 3,
    suggestedWidthKm: { "earth-science": 40, urban: 16 },
    description: "Tall poster for towers, canyons, city cores.",
  },
  {
    id: "panorama",
    name: "Panorama",
    aspectRatio: 3,
    suggestedWidthKm: { "earth-science": 90, urban: 36 },
    description: "Ultra-wide panoramic sweep.",
  },
];

export function getPresets(): ProductPreset[] {
  return AOI_PRESETS;
}

export function getPresetById(id: ProductPresetId): ProductPreset | undefined {
  return AOI_PRESETS.find((p) => p.id === id);
}
