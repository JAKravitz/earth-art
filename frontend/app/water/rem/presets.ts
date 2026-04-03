export type REMRiverId = "willamette" | "carson" | "yukon-flats" | "neches" | "birch-creek";

export type REMRiverPreset = {
  id: REMRiverId;
  name: string;
  description: string;
  center: { lat: number; lon: number };
  sizeKm: number;
};

export type REMSizeId = "small" | "medium" | "large";

export type REMSizePreset = {
  id: REMSizeId;
  label: string;
  km: number;
  description: string;
};

export const REM_RIVER_PRESETS: REMRiverPreset[] = [
  {
    id: "willamette",
    name: "Willamette River",
    description: "Oregon: Corvallis to Salem",
    center: { lat: 44.8, lon: -123.0 },
    sizeKm: 18,
  },
  {
    id: "carson",
    name: "Carson River",
    description: "Western Nevada",
    center: { lat: 39.3, lon: -119.6 },
    sizeKm: 12,
  },
  {
    id: "yukon-flats",
    name: "Yukon Flats",
    description: "Alaska",
    center: { lat: 66.5, lon: -150.0 },
    sizeKm: 25,
  },
  {
    id: "neches",
    name: "Neches River",
    description: "Texas",
    center: { lat: 30.2, lon: -94.2 },
    sizeKm: 14,
  },
  {
    id: "birch-creek",
    name: "Birch Creek",
    description: "Alaska",
    center: { lat: 66.0, lon: -145.5 },
    sizeKm: 20,
  },
];

export const REM_SIZE_PRESETS: REMSizePreset[] = [
  { id: "small", label: "Small", km: 8, description: "8 × 8 km" },
  { id: "medium", label: "Medium", km: 15, description: "15 × 15 km" },
  { id: "large", label: "Large", km: 25, description: "25 × 25 km" },
];

export const DEFAULT_REM_SIZE_ID: REMSizeId = "small";

export function getREMRiverById(id: REMRiverId): REMRiverPreset | undefined {
  return REM_RIVER_PRESETS.find((r) => r.id === id);
}

export function getREMSizeById(id: REMSizeId): REMSizePreset | undefined {
  return REM_SIZE_PRESETS.find((s) => s.id === id);
}
