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

// Legacy types kept for compatibility with existing components (pickers toggled off in new UI).
export type Theme = "true" | "false_veg" | "ndvi" | "pca" | "geology" | "decorr" | "nmf" | "index_triplet";
export type Palette = "vivid" | "warm" | "cool" | "neutral" | "random";
export type IndexPack = "veg" | "aqua" | "urban";
export interface OverlayOptions {
  roads: boolean;
  buildings: boolean;
}
