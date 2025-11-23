"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import PreviewPane from "./components/PreviewPane";
import SearchBar from "./components/SearchBar";
import {
  fetchBatchPreviews,
  exportFilterImage,
  BatchPreviewItem,
  BatchPreviewRequest,
  ExportFilterRequest,
} from "./api";
import { FILTERS, THEMES, ThemeId, getFilterById, getFiltersForTheme } from "./config/themesAndFilters";

type FilterPreviewStatus = "idle" | "loading" | "ready" | "error";

type FilterPreview = {
  status: FilterPreviewStatus;
  imageUrl?: string;
  bbox?: [number, number, number, number];
  scene?: Record<string, unknown>;
};

type PreviewState = Partial<Record<ThemeId, Record<string, FilterPreview>>>;

const sizePresets = [5, 10, 20];
const DEFAULT_THEME: ThemeId = "earth-science";

function boundsCenter(bounds: [number, number, number, number]) {
  const [w, s, e, n] = bounds;
  return { lat: (s + n) / 2, lon: (w + e) / 2 };
}

function boundsSizeKm(bounds: [number, number, number, number]) {
  const [w, s, e, n] = bounds;
  const centerLat = (s + n) / 2;
  const latKm = Math.abs(n - s) * 111;
  const lonKm = Math.abs(e - w) * 111 * Math.cos((centerLat * Math.PI) / 180);
  return Math.max(latKm, lonKm, 0);
}

export default function Page() {
  const [selectedSizeKm, setSelectedSizeKm] = useState(10);
  const [selectedThemeId, setSelectedThemeId] = useState<ThemeId>(DEFAULT_THEME);
  const [selectedFilterId, setSelectedFilterId] = useState<string>(
    getFiltersForTheme(DEFAULT_THEME)[0]?.id ?? FILTERS[0].id,
  );
  const [previewState, setPreviewState] = useState<PreviewState>({});
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [previewBounds, setPreviewBounds] = useState<[number, number, number, number] | null>(null);
  const [sceneInfo, setSceneInfo] = useState<Record<string, unknown> | undefined>(undefined);
  const [loadingPreviews, setLoadingPreviews] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [mapBounds, setMapBounds] = useState<[number, number, number, number] | null>(null);
  const [aoiBounds, setAoiBounds] = useState<[number, number, number, number] | null>(null);
  const [flyToTarget, setFlyToTarget] = useState<{ lat: number; lon: number; token: number } | null>(null);
  const [sizeCommand, setSizeCommand] = useState<number | null>(null);
  const [drawCommand, setDrawCommand] = useState<number>(0);
  const [clearCommand, setClearCommand] = useState<number>(0);
  const [exporting, setExporting] = useState(false);
  const previewRequestRef = useRef<NodeJS.Timeout | null>(null);

  const currentFilters = useMemo(() => getFiltersForTheme(selectedThemeId), [selectedThemeId]);
  const currentFilter = useMemo(() => getFilterById(selectedFilterId) ?? currentFilters[0], [currentFilters, selectedFilterId]);

  const effectiveBounds = useMemo(() => aoiBounds ?? mapBounds, [aoiBounds, mapBounds]);
  const payloadCenter = useMemo(
    () => (effectiveBounds ? boundsCenter(effectiveBounds) : { lat: 32.7157, lon: -117.1611 }),
    [effectiveBounds],
  );
  const payloadSizeKm = useMemo(
    () => (effectiveBounds ? boundsSizeKm(effectiveBounds) : selectedSizeKm),
    [effectiveBounds, selectedSizeKm],
  );

  const resetCurrentPreview = useCallback(() => {
    setPreviewImageUrl(null);
    setPreviewBounds(null);
    setSceneInfo(undefined);
  }, []);

  const updatePreviewFromState = useCallback(
    (themeId: ThemeId, filterId: string) => {
      const entry = previewState[themeId]?.[filterId];
      if (entry?.status === "ready" && entry.imageUrl) {
        setPreviewImageUrl(entry.imageUrl);
        setPreviewBounds(entry.bbox ?? null);
        setSceneInfo(entry.scene);
      } else {
        resetCurrentPreview();
      }
    },
    [previewState, resetCurrentPreview],
  );

  const setThemeAndFilter = useCallback(
    (themeId: ThemeId) => {
      const firstFilter = getFiltersForTheme(themeId)[0];
      setSelectedThemeId(themeId);
      if (firstFilter) {
        setSelectedFilterId(firstFilter.id);
        updatePreviewFromState(themeId, firstFilter.id);
      }
    },
    [updatePreviewFromState],
  );

  const markFiltersLoading = useCallback(
    (themeId: ThemeId) => {
      const filters = getFiltersForTheme(themeId);
      setPreviewState((prev) => {
        const next = { ...prev };
        const themeEntry: Record<string, FilterPreview> = {};
        filters.forEach((f) => {
          themeEntry[f.id] = { status: "loading" };
        });
        next[themeId] = { ...(next[themeId] || {}), ...themeEntry };
        return next;
      });
    },
    [],
  );

  const applyBatchResults = useCallback((themeId: ThemeId, results: BatchPreviewItem[]) => {
    const resultMap = new Map(results.map((r) => [r.id, r]));
    setPreviewState((prev) => {
      const next = { ...prev };
      const existing = { ...(next[themeId] || {}) };
      const filters = getFiltersForTheme(themeId);
      filters.forEach((f) => {
        const res = resultMap.get(f.id);
        if (res) {
          existing[f.id] = {
            status: "ready",
            imageUrl: `data:image/png;base64,${res.png_base64}`,
            bbox: res.bbox,
            scene: res.scene_metadata,
          };
        } else {
          existing[f.id] = existing[f.id] && existing[f.id].status === "ready" ? existing[f.id] : { status: "error" };
        }
      });
      next[themeId] = existing;
      return next;
    });
    const preferred = currentFilter && resultMap.has(currentFilter.id) ? currentFilter.id : results[0]?.id;
    if (preferred) {
      setSelectedFilterId(preferred);
      const matched = resultMap.get(preferred);
      setPreviewImageUrl(matched ? `data:image/png;base64,${matched.png_base64}` : null);
      setPreviewBounds(matched?.bbox ?? null);
      setSceneInfo(matched?.scene_metadata);
    }
  }, [currentFilter]);

  const triggerBatchPreview = useCallback(
    async (themeId: ThemeId) => {
      if (!aoiBounds) return;
      const filters = getFiltersForTheme(themeId);
      if (!filters.length) return;
      setLoadingPreviews(true);
      resetCurrentPreview();
      markFiltersLoading(themeId);
      const payload: BatchPreviewRequest = {
        lat: payloadCenter.lat,
        lon: payloadCenter.lon,
        size_km: payloadSizeKm,
        aoi_bounds: aoiBounds,
        themeId,
        preview: true,
        target_size_px: 320,
        filters: filters.map((f) => ({
          id: f.id,
          styleType: f.styleType,
          params: f.params,
        })),
      };
      try {
        const res = await fetchBatchPreviews(payload);
        applyBatchResults(themeId, res.results);
        setMessage(res.results.length === 0 ? "No previews generated" : null);
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Preview failed";
        setMessage(msg);
        setPreviewState((prev) => {
          const next = { ...prev };
          const themeEntry = { ...(next[themeId] || {}) };
          filters.forEach((f) => {
            themeEntry[f.id] = { status: "error" };
          });
          next[themeId] = themeEntry;
          return next;
        });
      } finally {
        setLoadingPreviews(false);
      }
    },
    [aoiBounds, applyBatchResults, markFiltersLoading, payloadCenter.lat, payloadCenter.lon, payloadSizeKm, resetCurrentPreview],
  );

  useEffect(() => {
    if (!aoiBounds) return;
    if (previewRequestRef.current) {
      clearTimeout(previewRequestRef.current);
    }
    previewRequestRef.current = setTimeout(() => {
      triggerBatchPreview(selectedThemeId);
      previewRequestRef.current = null;
    }, 150);
  }, [aoiBounds, selectedThemeId, triggerBatchPreview]);

  useEffect(() => {
    updatePreviewFromState(selectedThemeId, selectedFilterId);
  }, [selectedFilterId, selectedThemeId, updatePreviewFromState]);

  const handleFilterSelect = (id: string) => {
    setSelectedFilterId(id);
    const entry = previewState[selectedThemeId]?.[id];
    if (entry?.status === "ready" && entry.imageUrl) {
      setPreviewImageUrl(entry.imageUrl);
      setPreviewBounds(entry.bbox ?? null);
      setSceneInfo(entry.scene);
    }
  };

  const triggerSizeCommand = (value: number) => {
    setPreviewImageUrl(null);
    setAoiBounds(null);
    setClearCommand((c) => c + 1);
    setSizeCommand(value);
  };

  const triggerDraw = () => {
    setPreviewImageUrl(null);
    setAoiBounds(null);
    setDrawCommand((c) => c + 1);
  };

  const runExport = async () => {
    if (!aoiBounds) {
      setMessage("Draw an AOI first.");
      return;
    }
    if (!currentFilter) {
      setMessage("Select a filter first.");
      return;
    }
    setExporting(true);
    setMessage("Rendering export…");
    const payload: ExportFilterRequest = {
      lat: payloadCenter.lat,
      lon: payloadCenter.lon,
      size_km: payloadSizeKm,
      aoi_bounds: aoiBounds,
      target_size_px: 4096,
      filter: {
        id: currentFilter.id,
        styleType: currentFilter.styleType,
        params: currentFilter.params,
      },
    };
    try {
      const blob = await exportFilterImage(payload);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `earth-art-${currentFilter.id}.png`;
      link.click();
      URL.revokeObjectURL(url);
      setMessage("Export ready.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const anyLoading = loadingPreviews || !!currentFilters.find((f) => previewState[selectedThemeId]?.[f.id]?.status === "loading");
  const previewForFilter = previewState[selectedThemeId]?.[selectedFilterId];

  return (
    <main className="page">
      <section className="controls">
        <h1>Earth Art</h1>
        <p className="subtitle">Search, draw an AOI, and flip through artful filters instantly.</p>
        <SearchBar
          onSelect={(lat, lon, label) => {
            setFlyToTarget({ lat, lon, token: Date.now() });
            setMessage(`Focused on ${label}`);
            setPreviewImageUrl(null);
            setAoiBounds(null);
          }}
        />
        <div className="size-picker">
          <p>Area size (km)</p>
          <div className="preset-group">
            {sizePresets.map((option) => (
              <button
                key={option}
                className={Math.round(option) === Math.round(selectedSizeKm) ? "active" : ""}
                onClick={() => {
                  setSelectedSizeKm(option);
                  triggerSizeCommand(option);
                }}
              >
                {option} km
              </button>
            ))}
          </div>
          <label className="size-freeform">
            Custom
            <input
              type="range"
              min={1}
              max={500}
              step={1}
              value={selectedSizeKm}
              onChange={(e) => setSelectedSizeKm(Number(e.target.value))}
              onMouseUp={(e) => {
                const nextValue = Number(e.currentTarget.value);
                setSelectedSizeKm(nextValue);
                triggerSizeCommand(nextValue);
              }}
              onTouchEnd={(e) => {
                const target = e.currentTarget as HTMLInputElement;
                const nextValue = Number(target.value);
                setSelectedSizeKm(nextValue);
                triggerSizeCommand(nextValue);
              }}
            />
            <input
              type="number"
              min={1}
              max={50}
              step={1}
              value={selectedSizeKm}
              onChange={(e) => setSelectedSizeKm(Number(e.target.value))}
              onBlur={(e) => {
                const nextValue = Number(e.target.value);
                setSelectedSizeKm(nextValue);
                triggerSizeCommand(nextValue);
              }}
            />
            km
          </label>
        </div>
        <div className="actions-row">
          <button onClick={triggerDraw}>Draw AOI</button>
          <button onClick={() => setClearCommand((c) => c + 1)}>Clear</button>
        </div>
        <div className="theme-switcher">
          {THEMES.map((theme) => (
            <button
              key={theme.id}
              className={theme.id === selectedThemeId ? "active" : ""}
              onClick={() => {
                setThemeAndFilter(theme.id);
                if (aoiBounds) {
                  triggerBatchPreview(theme.id);
                }
              }}
            >
              {theme.name}
            </button>
          ))}
        </div>
        <div className="filter-grid">
          {currentFilters.map((filter) => {
            const status = previewState[selectedThemeId]?.[filter.id]?.status ?? "idle";
            return (
              <button
                key={filter.id}
                className={`filter-card ${selectedFilterId === filter.id ? "active" : ""}`}
                onClick={() => handleFilterSelect(filter.id)}
              >
                <div className="filter-header">
                  <span className="filter-name">{filter.name}</span>
                  <span className={`status-dot ${status}`}></span>
                </div>
                <p className="filter-description">{filter.description}</p>
              </button>
            );
          })}
        </div>
        <div className="actions">
          <button onClick={() => aoiBounds && triggerBatchPreview(selectedThemeId)} disabled={!aoiBounds || anyLoading}>
            {anyLoading ? "Rendering…" : "Refresh Previews"}
          </button>
          <button onClick={runExport} disabled={exporting || anyLoading || !previewForFilter || previewForFilter.status !== "ready"}>
            {exporting ? "Exporting…" : "Export 4K"}
          </button>
        </div>
        {message && <p className="hint">{message}</p>}
        <pre className="debug-aoi">AOI bounds: {aoiBounds ? JSON.stringify(aoiBounds) : "null"}</pre>
      </section>
      <section className="preview-section">
        <PreviewPane
          selectedSizeKm={selectedSizeKm}
          sizeCommand={sizeCommand}
          drawCommand={drawCommand}
          clearCommand={clearCommand}
          flyToTarget={flyToTarget}
          previewImageUrl={previewImageUrl}
          previewBounds={previewBounds}
          loading={anyLoading}
          sceneInfo={sceneInfo}
          showSelection={true}
          basemap="imagery"
          onBoundsChange={setMapBounds}
          onAoiBoundsChange={setAoiBounds}
          onClearPreview={resetCurrentPreview}
          onSizeCommandHandled={() => setSizeCommand(null)}
        />
      </section>
      <style jsx>{`
        .page {
          display: grid;
          grid-template-columns: 340px minmax(0, 1fr);
          gap: 2rem;
          min-height: 100vh;
          padding: 2rem;
          background: radial-gradient(circle at top, #111b2b, #05070c);
        }
        .controls {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          padding: 1.25rem;
          border-radius: 18px;
          background: rgba(15, 23, 42, 0.9);
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.35);
        }
        .preview-section {
          width: 100%;
        }
        .subtitle {
          color: #94a3b8;
          margin-top: 0;
        }
        .preset-group {
          display: flex;
          gap: 0.5rem;
        }
        .preset-group button {
          flex: 1;
          padding: 0.5rem;
          border-radius: 8px;
          border: 1px solid #1f2937;
          background: transparent;
          color: #fff;
        }
        .preset-group button.active {
          background: #2563eb;
          border-color: #2563eb;
        }
        .size-freeform {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          font-size: 0.9rem;
          margin-top: 0.35rem;
        }
        .size-freeform input[type='number'] {
          width: 72px;
          padding: 0.25rem;
          border-radius: 6px;
          border: 1px solid #1f2937;
          background: rgba(0, 0, 0, 0.2);
          color: #fff;
        }
        .size-freeform input[type='range'] {
          flex: 1;
        }
        .actions-row {
          display: flex;
          gap: 0.5rem;
        }
        .theme-switcher {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0.5rem;
        }
        .theme-switcher button {
          padding: 0.6rem;
          border-radius: 10px;
          border: 1px solid #1f2937;
          background: rgba(255, 255, 255, 0.03);
          color: #e5e7eb;
        }
        .theme-switcher button.active {
          background: linear-gradient(135deg, #2563eb, #7c3aed);
          border-color: #2563eb;
          color: #fff;
        }
        .filter-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0.6rem;
        }
        .filter-card {
          text-align: left;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid #1f2937;
          border-radius: 12px;
          padding: 0.65rem;
          color: #e2e8f0;
          min-height: 96px;
        }
        .filter-card:hover {
          border-color: #2563eb;
          cursor: pointer;
        }
        .filter-card.active {
          border-color: #2563eb;
          box-shadow: 0 6px 18px rgba(37, 99, 235, 0.25);
        }
        .filter-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.25rem;
        }
        .filter-name {
          font-weight: 600;
          color: #fff;
        }
        .filter-description {
          margin: 0;
          color: #94a3b8;
          font-size: 0.85rem;
        }
        .status-dot {
          display: inline-block;
          width: 10px;
          height: 10px;
          border-radius: 999px;
          background: #475569;
        }
        .status-dot.ready {
          background: #22c55e;
        }
        .status-dot.loading {
          background: #f59e0b;
          animation: pulse 1.2s infinite;
        }
        .status-dot.error {
          background: #ef4444;
        }
        @keyframes pulse {
          0% { opacity: 0.6; }
          50% { opacity: 1; }
          100% { opacity: 0.6; }
        }
        .actions {
          display: flex;
          gap: 0.5rem;
        }
        .actions button {
          flex: 1;
        }
        .hint {
          color: #f87171;
          margin: 0;
          font-size: 0.9rem;
        }
        .debug-aoi {
          font-size: 0.75rem;
          color: #64748b;
          margin: 0.25rem 0 0;
          word-break: break-all;
        }
        button {
          border: none;
          background: #2563eb;
          color: #fff;
          padding: 0.65rem 0.9rem;
          border-radius: 10px;
        }
        button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      `}</style>
    </main>
  );
}
