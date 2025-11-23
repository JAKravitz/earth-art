import type { Feature, Polygon } from "geojson";
import type { ProductPreset } from "../config/aoiPresets";
import type { ThemeId } from "../config/themesAndFilters";

export function createAoiPolygonFromPreset(
  preset: ProductPreset,
  themeId: ThemeId,
  centerLon: number,
  centerLat: number,
): Feature<Polygon> {
  const widthKm = preset.suggestedWidthKm[themeId];
  const aspect = preset.aspectRatio || 1;
  const heightKm = widthKm / aspect;

  const latKmPerDeg = 110.574;
  const lonKmPerDeg = 111.32 * Math.cos((centerLat * Math.PI) / 180);

  const halfWidthDeg = (widthKm / 2) / lonKmPerDeg;
  const halfHeightDeg = (heightKm / 2) / latKmPerDeg;

  const minLon = centerLon - halfWidthDeg;
  const maxLon = centerLon + halfWidthDeg;
  const minLat = centerLat - halfHeightDeg;
  const maxLat = centerLat + halfHeightDeg;

  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [minLon, minLat],
          [maxLon, minLat],
          [maxLon, maxLat],
          [minLon, maxLat],
          [minLon, minLat],
        ],
      ],
    },
    properties: {},
  };
}

export function bboxFromFeature(feature: Feature<Polygon>): [number, number, number, number] {
  const coords = feature.geometry.coordinates[0];
  const lons = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  return [minLon, minLat, maxLon, maxLat];
}
