import { FilterConfig, ThemeId } from "./config/themesAndFilters";

export interface AoiPayload {
  lat: number;
  lon: number;
  size_km: number;
  aoi_bounds?: [number, number, number, number];
}

export type FilterStyleType = FilterConfig["styleType"];

export interface FilterRequestItem {
  id: string;
  styleType: FilterStyleType;
  params: Record<string, unknown>;
}

export interface BatchPreviewRequest extends AoiPayload {
  themeId: ThemeId;
  filters: FilterRequestItem[];
  preview?: boolean;
  target_size_px?: number;
}

export interface BatchPreviewItem {
  id: string;
  png_base64: string;
  bbox: [number, number, number, number];
  scene_metadata?: Record<string, unknown>;
}

export interface BatchPreviewResponse {
  results: BatchPreviewItem[];
}

export interface ExportFilterRequest extends AoiPayload {
  filter: FilterRequestItem;
  target_size_px: number;
  watermark?: string;
  adjustments?: { brightness?: number; contrast?: number; saturation?: number };
}

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || "Request failed");
  }
  return res.json() as Promise<T>;
}

export async function fetchBatchPreviews(payload: BatchPreviewRequest): Promise<BatchPreviewResponse> {
  const res = await fetch(`${API_BASE}/filters/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse<BatchPreviewResponse>(res);
}

export async function exportFilterImage(payload: ExportFilterRequest) {
  const res = await fetch(`${API_BASE}/filters/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || "Export failed");
  }
  return res.blob();
}

export type RoadNetworkStyle = "blueprint" | "gold" | "ink";

export interface RoadNetworkPreviewRequest {
  aoi: Record<string, unknown>;
  style: RoadNetworkStyle;
  width_px: number;
  height_px: number;
  seed?: number;
}

export async function fetchRoadNetworkPreview(
  payload: RoadNetworkPreviewRequest,
  signal?: AbortSignal,
): Promise<Blob> {
  const res = await fetch(`${API_BASE}/roads/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || "Roads preview failed");
  }
  return res.blob();
}

export interface REMPreviewRequest {
  bbox: [number, number, number, number];
  target_size_px?: number;
  colormap?: string;
}

export interface REMExportRequest {
  bbox: [number, number, number, number];
  target_size_px: number;
  colormap?: string;
}

/** Fetch USGS 3DEP 1 m DEM coverage polygons for a bbox (for "show where DEMs exist" layer). */
export async function fetch3depCoverage(
  bbox: [number, number, number, number],
): Promise<GeoJSON.FeatureCollection> {
  const [west, south, east, north] = bbox;
  const res = await fetch(
    `${API_BASE}/rem/3dep-coverage?bbox=${west},${south},${east},${north}`,
  );
  if (!res.ok) throw new Error("Failed to fetch 3DEP coverage");
  const data = (await res.json()) as GeoJSON.FeatureCollection | { features?: unknown[] };
  // Normalize: ensure we have a FeatureCollection with an array (ArcGIS can wrap or error)
  const features = Array.isArray((data as GeoJSON.FeatureCollection).features)
    ? (data as GeoJSON.FeatureCollection).features
    : [];
  return { type: "FeatureCollection", features };
}

/** Fetch polygons where 3DEP 1m has *no* coverage (bbox minus coverage). Show in red on map. */
export async function fetch3depNoCoverage(
  bbox: [number, number, number, number],
): Promise<GeoJSON.FeatureCollection> {
  const [west, south, east, north] = bbox;
  const res = await fetch(
    `${API_BASE}/rem/3dep-no-coverage?bbox=${west},${south},${east},${north}`,
  );
  if (!res.ok) throw new Error("Failed to fetch 3DEP no-coverage");
  const data = (await res.json()) as GeoJSON.FeatureCollection | { features?: unknown[] };
  const features = Array.isArray((data as GeoJSON.FeatureCollection).features)
    ? (data as GeoJSON.FeatureCollection).features
    : [];
  return { type: "FeatureCollection", features };
}

export async function remPreview(
  payload: REMPreviewRequest,
  signal?: AbortSignal,
): Promise<Blob> {
  const res = await fetch(`${API_BASE}/rem/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text || "REM preview failed";
    try {
      const json = JSON.parse(text) as { detail?: string };
      if (typeof json.detail === "string") message = json.detail;
    } catch {
      // use text as-is
    }
    throw new Error(message);
  }
  return res.blob();
}

export async function remExport(payload: REMExportRequest): Promise<Blob> {
  const res = await fetch(`${API_BASE}/rem/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text || "REM export failed";
    try {
      const json = JSON.parse(text) as { detail?: string };
      if (typeof json.detail === "string") message = json.detail;
    } catch {
      // use text as-is
    }
    throw new Error(message);
  }
  return res.blob();
}

// Legacy types kept for compatibility with existing components (pickers toggled off in new UI).
export type Theme = "true" | "false_veg" | "ndvi" | "pca" | "geology" | "decorr" | "nmf" | "index_triplet";
export type Palette = "vivid" | "warm" | "cool" | "neutral" | "random";
export type IndexPack = "veg" | "aqua" | "urban";
export interface OverlayOptions {
  roads: boolean;
  buildings: boolean;
}
