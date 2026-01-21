export type RoadCityId = "new-york" | "london" | "paris" | "tokyo" | "san-francisco" | "amsterdam";
export type RoadSizeId = "small" | "medium" | "large" | "xlarge";

export type RoadCityPreset = {
  id: RoadCityId;
  name: string;
  country: string;
  center: { lat: number; lon: number };
};

export type RoadSizePreset = {
  id: RoadSizeId;
  label: string;
  km: number;
  description: string;
};

export const ROAD_CITY_PRESETS: RoadCityPreset[] = [
  {
    id: "new-york",
    name: "New York City",
    country: "USA",
    center: { lat: 40.7128, lon: -74.006 },
  },
  {
    id: "london",
    name: "London",
    country: "UK",
    center: { lat: 51.5074, lon: -0.1278 },
  },
  {
    id: "paris",
    name: "Paris",
    country: "France",
    center: { lat: 48.8566, lon: 2.3522 },
  },
  {
    id: "tokyo",
    name: "Tokyo",
    country: "Japan",
    center: { lat: 35.6895, lon: 139.6917 },
  },
  {
    id: "san-francisco",
    name: "San Francisco",
    country: "USA",
    center: { lat: 37.7749, lon: -122.4194 },
  },
  {
    id: "amsterdam",
    name: "Amsterdam",
    country: "Netherlands",
    center: { lat: 52.3676, lon: 4.9041 },
  },
];

export const ROAD_SIZE_PRESETS: RoadSizePreset[] = [
  { id: "small", label: "Small", km: 4, description: "4 × 4 km" },
  { id: "medium", label: "Medium", km: 8, description: "8 × 8 km" },
  { id: "large", label: "Large", km: 12, description: "12 × 12 km" },
  { id: "xlarge", label: "Extra Large", km: 18, description: "18 × 18 km" },
];

export const DEFAULT_ROAD_SIZE_ID: RoadSizeId = "medium";

export function getRoadCityById(id: RoadCityId) {
  return ROAD_CITY_PRESETS.find((city) => city.id === id);
}

export function getRoadSizeById(id: RoadSizeId) {
  return ROAD_SIZE_PRESETS.find((size) => size.id === id);
}
