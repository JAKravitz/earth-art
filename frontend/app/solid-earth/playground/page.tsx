"use client";

import { Suspense, useEffect, useMemo, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PreviewPane from "../../components/PreviewPane";
import { getPresets, ProductPresetId } from "../../config/aoiPresets";
import { THEMES, getFiltersForTheme, ThemeId } from "../../config/themesAndFilters";
import { fetchBatchPreviews, BatchPreviewRequest } from "../../api";
import SearchBar from "../../components/SearchBar";
import { useEarthsySession } from "../../context/EarthsySession";

const DEFAULT_CENTER = { lat: 32.7157, lon: -117.1611 };
const DEFAULT_THEME: ThemeId = "earth-science";

type PresetSizeSpec = { widthKm: number; heightKm: number };

const PRESET_SPECS: Record<ProductPresetId, PresetSizeSpec> = {
  square: { widthKm: 20, heightKm: 20 },
  "poster-landscape": { widthKm: 30, heightKm: 20 },
  "poster-portrait": { widthKm: 20, heightKm: 30 },
  panorama: { widthKm: 60, heightKm: 15 },
};

function centerFromBounds(bbox: [number, number, number, number]) {
  const [west, south, east, north] = bbox;
  return { lat: (south + north) / 2, lon: (west + east) / 2 };
}

function bboxAroundCenterKm(
  center: { lat: number; lon: number },
  widthKm: number,
  heightKm: number,
): [number, number, number, number] {
  const earthRadiusKm = 6371;
  const latRad = (center.lat * Math.PI) / 180;

  const dLat = (heightKm / earthRadiusKm) * (180 / Math.PI);
  const dLon = ((widthKm / earthRadiusKm) * (180 / Math.PI)) / Math.cos(latRad || 1e-6);

  const south = center.lat - dLat / 2;
  const north = center.lat + dLat / 2;
  const west = center.lon - dLon / 2;
  const east = center.lon + dLon / 2;

  return [west, south, east, north];
}

function PlaygroundInner() {
  const search = useSearchParams();
  const router = useRouter();
  const {
    setProduct,
    setTheme,
    setCenter: setSessionCenter,
    setPreset,
    setAoi,
    setPreviews,
    setSelectedFilterId,
    previewsByFilterId,
    hydrated,
  } = useEarthsySession();
  const [selectedThemeId, setSelectedThemeId] = useState<ThemeId>(DEFAULT_THEME);
  const [selectedPresetId, setSelectedPresetId] = useState<ProductPresetId | null>(null);
  const [center, setCenter] = useState(DEFAULT_CENTER);
  const [aoiBounds, setAoiBounds] = useState<[number, number, number, number] | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [previewBounds, setPreviewBounds] = useState<[number, number, number, number] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readyForEditor, setReadyForEditor] = useState(false);
  const [flyTarget, setFlyTarget] = useState<{ lat: number; lon: number; token: number } | null>(null);
  const [initializedFromUrl, setInitializedFromUrl] = useState(false);
  const presets = useMemo(() => getPresets(), []);
  const activePresetSpec = selectedPresetId ? PRESET_SPECS[selectedPresetId] : null;
  const handleClearPreview = useCallback(() => setPreviewImageUrl(null), []);

  useEffect(() => {
    if (initializedFromUrl) return;
    const lat = parseFloat(search.get("lat") || `${DEFAULT_CENTER.lat}`);
    const lon = parseFloat(search.get("lon") || `${DEFAULT_CENTER.lon}`);
    const preset = (search.get("preset") as ProductPresetId | null) || null;
    const centerVal = { lat, lon };
    setCenter(centerVal);
    setFlyTarget({ lat, lon, token: Date.now() });
    if (preset) {
      const spec = PRESET_SPECS[preset];
      if (spec) {
        const bbox = bboxAroundCenterKm(centerVal, spec.widthKm, spec.heightKm);
        setSelectedPresetId(preset);
        setAoiBounds(bbox);
      } else {
        setSelectedPresetId(null);
      }
    } else {
      setSelectedPresetId(null);
    }
    setInitializedFromUrl(true);
  }, [initializedFromUrl, search]);

  useEffect(() => {
    if (!selectedPresetId) return;
    // No-op while a preset is active; aoiBounds is driven by PreviewPane via onAoiBoundsChange.
  }, [selectedPresetId]);

  const handleRender = async () => {
    if (!selectedPresetId || !aoiBounds) return;
    const presetSpec = PRESET_SPECS[selectedPresetId];
    const maxSideKm = presetSpec ? Math.max(presetSpec.widthKm, presetSpec.heightKm) : 20;
    const targetPx = Math.max(640, Math.min(2048, Math.round((maxSideKm / 20) * 1024)));
    const aoiCenter = centerFromBounds(aoiBounds);
    setLoading(true);
    setError(null);
    setPreviewImageUrl(null);
    const filters = getFiltersForTheme(selectedThemeId);
    const payload: BatchPreviewRequest = {
      lat: aoiCenter.lat,
      lon: aoiCenter.lon,
      size_km: Math.max(...filters.map(() => 20)),
      aoi_bounds: aoiBounds,
      themeId: selectedThemeId,
      preview: true,
      target_size_px: targetPx,
      filters: filters.map((f) => ({ id: f.id, styleType: f.styleType, params: f.params })),
    };
    try {
      const res = await fetchBatchPreviews(payload);
      if (!res.results.length) {
        throw new Error("No previews were returned. Please try again.");
      }

      const preferred = res.results.find((item) => item.id === "true-color") || res.results[0];
      const referenceBbox = preferred?.bbox ?? aoiBounds;
      const sessionCenter = referenceBbox ? centerFromBounds(referenceBbox) : aoiCenter;
      const previewEntries = Object.fromEntries(
        res.results.map((item) => [
          item.id,
          {
            imageUrl: `data:image/png;base64,${item.png_base64}`,
            filterId: item.id,
            bbox: item.bbox ?? aoiBounds,
            scene: item.scene_metadata,
          },
        ]),
      );

      setPreviewImageUrl(`data:image/png;base64,${preferred.png_base64}`);
      setPreviewBounds(referenceBbox);

      setProduct("solid-earth");
      setTheme(selectedThemeId);
      setSessionCenter(sessionCenter);
      setPreset(selectedPresetId);
      setAoi(null, referenceBbox);
      setPreviews(previewEntries);
      setSelectedFilterId(preferred.id);
      setReadyForEditor(true);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to render previews");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!readyForEditor || !hydrated) return;
    const hasPreviews = Object.keys(previewsByFilterId).length > 0;
    if (hasPreviews) {
      router.push("/solid-earth/editor");
      setReadyForEditor(false);
    } else if (!loading) {
      setError("Previews did not persist. Please try rendering again.");
      setReadyForEditor(false);
    }
  }, [hydrated, loading, previewsByFilterId, readyForEditor, router]);

  return (
    <div className="playground">
      <aside className="sidebar">
        <p className="eyebrow">Solid Earth</p>
        <h1>Choose your canvas</h1>
        <div className="search">
          <SearchBar
            onSelect={(lat, lon) => {
              const next = { lat, lon };
              setCenter(next);
              setFlyTarget({ lat, lon, token: Date.now() });
            }}
          />
        </div>
        <div className="preset-list">
        {presets.map((p) => (
          <button
            key={p.id}
          className={`preset-card ${selectedPresetId === p.id ? "active" : ""}`}
          onClick={() => {
            if (selectedPresetId === p.id) {
              setSelectedPresetId(null);
              setAoiBounds(null);
              setPreviewImageUrl(null);
              setPreviewBounds(null);
              return;
            }
            const spec = PRESET_SPECS[p.id];
            if (!spec) return;
            const bbox = bboxAroundCenterKm(center, spec.widthKm, spec.heightKm);
              setSelectedPresetId(p.id);
              setAoiBounds(bbox);
              setPreviewImageUrl(null);
              setPreviewBounds(null);
            }}
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
        {error ? <p className="error">{error}</p> : null}
        <button className="primary" disabled={!selectedPresetId || loading} onClick={handleRender}>
          {loading ? "Rendering…" : "Render previews"}
        </button>
      </aside>
      <div className="map-area">
        <PreviewPane
          selectedSizeKm={20}
          sizeCommand={null}
          flyToTarget={flyTarget}
          previewImageUrl={previewImageUrl}
          previewBounds={previewBounds}
          presetBounds={aoiBounds}
          activePresetId={selectedPresetId}
          presetAspect={activePresetSpec ? activePresetSpec.widthKm / activePresetSpec.heightKm : null}
          loading={loading}
          sceneInfo={undefined}
          showSelection={true}
          basemap="imagery"
            onMapCenterChange={(c) => {
              if (!selectedPresetId) setCenter(c);
            }}
          onFlyComplete={() => setFlyTarget(null)}
          onAoiBoundsChange={setAoiBounds}
          onClearPreview={handleClearPreview}
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
        .error {
          color: #f87171;
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

export default function SolidEarthPlayground() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading playground…</div>}>
      <PlaygroundInner />
    </Suspense>
  );
}
