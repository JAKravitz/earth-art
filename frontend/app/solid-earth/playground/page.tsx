"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PreviewPane from "../../components/PreviewPane";
import { getPresets, ProductPresetId } from "../../config/aoiPresets";
import { THEMES, getFiltersForTheme, ThemeId } from "../../config/themesAndFilters";
import { createAoiPolygonFromPreset, bboxFromFeature } from "../../utils/aoiFromPreset";
import { fetchBatchPreviews, BatchPreviewRequest } from "../../api";

const DEFAULT_CENTER = { lat: 32.7157, lon: -117.1611 };
const DEFAULT_THEME: ThemeId = "earth-science";

export default function SolidEarthPlayground() {
  const search = useSearchParams();
  const router = useRouter();
  const [selectedThemeId, setSelectedThemeId] = useState<ThemeId>(DEFAULT_THEME);
  const [selectedPresetId, setSelectedPresetId] = useState<ProductPresetId | null>(null);
  const [center, setCenter] = useState(DEFAULT_CENTER);
  const [aoiBounds, setAoiBounds] = useState<[number, number, number, number] | null>(null);
  const [mapBounds, setMapBounds] = useState<[number, number, number, number] | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [previewBounds, setPreviewBounds] = useState<[number, number, number, number] | null>(null);
  const [loading, setLoading] = useState(false);
  const presets = useMemo(() => getPresets(), []);

  useEffect(() => {
    const lat = parseFloat(search.get("lat") || `${DEFAULT_CENTER.lat}`);
    const lon = parseFloat(search.get("lon") || `${DEFAULT_CENTER.lon}`);
    const preset = (search.get("preset") as ProductPresetId | null) || null;
    setCenter({ lat, lon });
    if (preset) setSelectedPresetId(preset);
  }, [search]);

  useEffect(() => {
    if (!selectedPresetId) return;
    const preset = presets.find((p) => p.id === selectedPresetId);
    if (!preset) return;
    const feature = createAoiPolygonFromPreset(preset, selectedThemeId, center.lon, center.lat);
    const bbox = bboxFromFeature(feature);
    setAoiBounds(bbox);
  }, [center.lat, center.lon, presets, selectedPresetId, selectedThemeId]);

  const handleRender = async () => {
    if (!selectedPresetId || !aoiBounds) return;
    setLoading(true);
    setPreviewImageUrl(null);
    const filters = getFiltersForTheme(selectedThemeId);
    const payload: BatchPreviewRequest = {
      lat: center.lat,
      lon: center.lon,
      size_km: Math.max(...filters.map(() => 20)),
      aoi_bounds: aoiBounds,
      themeId: selectedThemeId,
      preview: true,
      target_size_px: 320,
      filters: filters.map((f) => ({ id: f.id, styleType: f.styleType, params: f.params })),
    };
    try {
      const res = await fetchBatchPreviews(payload);
      if (res.results.length) {
        setPreviewImageUrl(`data:image/png;base64,${res.results[0].png_base64}`);
        setPreviewBounds(res.results[0].bbox);
      }
      // TODO: stash previews in shared session context then navigate
      router.push("/solid-earth/editor");
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="playground">
      <aside className="sidebar">
        <p className="eyebrow">Solid Earth</p>
        <h1>Choose your canvas</h1>
        <div className="preset-list">
          {presets.map((p) => (
            <button
              key={p.id}
              className={`preset-card ${selectedPresetId === p.id ? "active" : ""}`}
              onClick={() => setSelectedPresetId(p.id)}
            >
              <div className="outline" style={{ aspectRatio: `${p.aspectRatio}` }} />
              <div>
                <div className="title">{p.name}</div>
                <div className="desc">{p.description}</div>
              </div>
            </button>
          ))}
        </div>
        <p className="hint">Move the map to frame your artwork. We keep a wider view so prints look smooth.</p>
        <button className="primary" disabled={!selectedPresetId || loading} onClick={handleRender}>
          {loading ? "Rendering…" : "Render previews"}
        </button>
      </aside>
      <div className="map-area">
        <PreviewPane
          selectedSizeKm={20}
          sizeCommand={null}
          drawCommand={0}
          clearCommand={0}
          flyToTarget={{ lat: center.lat, lon: center.lon, token: Date.now() }}
          previewImageUrl={previewImageUrl}
          previewBounds={previewBounds}
          presetBounds={aoiBounds}
          loading={loading}
          sceneInfo={undefined}
          showSelection={true}
          basemap="imagery"
          onBoundsChange={setMapBounds}
          onAoiBoundsChange={setAoiBounds}
          onClearPreview={() => setPreviewImageUrl(null)}
          onSizeCommandHandled={() => null}
        />
      </div>
      <style jsx>{`
        .playground {
          display: grid;
          grid-template-columns: 360px minmax(0, 1fr);
          min-height: calc(100vh - 72px);
        }
        .sidebar {
          padding: 24px;
          background: rgba(10, 14, 25, 0.92);
          border-right: 1px solid rgba(255, 255, 255, 0.05);
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .eyebrow {
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-size: 0.8rem;
          color: #94a3b8;
          margin: 0;
        }
        h1 {
          margin: 0;
        }
        .preset-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin: 12px 0;
        }
        .preset-card {
          display: grid;
          grid-template-columns: 72px 1fr;
          gap: 10px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          padding: 10px;
          text-align: left;
          color: #e5e7eb;
        }
        .preset-card.active {
          border-color: #2563eb;
          box-shadow: 0 12px 26px rgba(37, 99, 235, 0.25);
        }
        .outline {
          width: 100%;
          border: 1px dashed rgba(255, 255, 255, 0.3);
          border-radius: 6px;
        }
        .title {
          font-weight: 600;
        }
        .desc {
          color: #94a3b8;
          font-size: 0.9rem;
        }
        .hint {
          color: #94a3b8;
          margin: 0;
        }
        .primary {
          margin-top: auto;
          padding: 12px 14px;
          border: none;
          border-radius: 10px;
          background: linear-gradient(135deg, #2563eb, #7c3aed);
          color: #fff;
          font-weight: 700;
        }
        .map-area {
          position: relative;
        }
      `}</style>
    </div>
  );
}
