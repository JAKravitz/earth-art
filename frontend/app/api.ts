export type Theme = "true" | "false_veg" | "ndvi" | "pca" | "geology" | "decorr" | "nmf" | "index_triplet";

export type Palette = "vivid" | "warm" | "cool" | "neutral" | "random";
export type IndexPack = "veg" | "aqua" | "urban";

export interface OverlayOptions {
  roads: boolean;
  buildings: boolean;
}

export interface PreviewPayload {
  lat: number;
  lon: number;
  size_km: number;
  theme: Theme;
  overlays: OverlayOptions;
  palette?: Palette;
  pcaScheme?: Palette;
  indexPack?: IndexPack;
}

export interface PreviewResponse {
  png_base64: string;
  bbox: [number, number, number, number];
  scene_metadata: Record<string, unknown>;
}

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || "Request failed");
  }
  return res.json() as Promise<T>;
}

export async function fetchPreview(payload: PreviewPayload): Promise<PreviewResponse> {
  const res = await fetch(`${API_BASE}/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse<PreviewResponse>(res);
}

export async function exportImage(payload: PreviewPayload & { target_size_px: number; watermark?: string }) {
  const res = await fetch(`${API_BASE}/export`, {
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
