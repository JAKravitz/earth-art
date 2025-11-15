"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { exportImage, fetchPreview, IndexPack, OverlayOptions, Palette, Theme } from "./api";
import OverlayToggles from "./components/OverlayToggles";
import PalettePicker from "./components/PalettePicker";
import PreviewPane from "./components/PreviewPane";
import SearchBar from "./components/SearchBar";
import IndexPackPicker from "./components/IndexPackPicker";
import ThemePicker from "./components/ThemePicker";

const sizePresets = [5, 10, 20];
const paletteAwareThemes: Theme[] = ["pca", "decorr", "nmf", "index_triplet"];

type PreviewState = {
  image?: string;
  bbox?: [number, number, number, number];
  scene?: Record<string, unknown>;
};

function bboxFromCenter(lat: number, lon: number, sizeKm: number): [number, number, number, number] {
  const halfDegLat = (sizeKm / 2) / 111;
  const halfDegLon = (sizeKm / 2) / (111 * Math.cos((lat * Math.PI) / 180));
  return [lon - halfDegLon, lat - halfDegLat, lon + halfDegLon, lat + halfDegLat];
}

export default function Page() {
  const [center, setCenter] = useState({ lat: 32.7157, lon: -117.1611 });
  const [sizeKm, setSizeKm] = useState(10);
  const [theme, setTheme] = useState<Theme>("true");
  const [palette, setPalette] = useState<Palette>("vivid");
  const [indexPack, setIndexPack] = useState<IndexPack>("veg");
  const [roadColor, setRoadColor] = useState("#00ffff");
  const [roadWidth, setRoadWidth] = useState(2);
  const [roadOpacity, setRoadOpacity] = useState(1);
  const [buildingColor, setBuildingColor] = useState("#ff00ff");
  const [buildingOutline, setBuildingOutline] = useState(1);
  const [buildingFillOpacity, setBuildingFillOpacity] = useState(0.15);
  const [buildingOpacity, setBuildingOpacity] = useState(0.8);
  const [bgMode, setBgMode] = useState<"imagery" | "solid">("imagery");
  const [bgColor, setBgColor] = useState("#0e0e10");
  const [overlays, setOverlays] = useState<OverlayOptions>({ roads: false, buildings: false });
  const [basemapMode, setBasemapMode] = useState<"imagery" | "vector">("imagery");
  const [preview, setPreview] = useState<PreviewState>({});
  const [showSelection, setShowSelection] = useState(true);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [mapBounds, setMapBounds] = useState<[number, number, number, number] | null>(null);
  const previewClickRef = useRef<NodeJS.Timeout | null>(null);

  const bbox = useMemo(() => preview.bbox ?? bboxFromCenter(center.lat, center.lon, sizeKm), [preview.bbox, center, sizeKm]);

  const paletteEnabled = paletteAwareThemes.includes(theme);
  const overlayStyles = useMemo(
    () => ({
      roads: { color: roadColor, width: roadWidth, opacity: roadOpacity },
      buildings: {
        color: buildingColor,
        width: buildingOutline,
        opacity: buildingOpacity,
        fill_opacity: buildingFillOpacity,
      },
    }),
    [roadColor, roadWidth, roadOpacity, buildingColor, buildingOutline, buildingOpacity, buildingFillOpacity],
  );
  const backgroundConfig = useMemo(
    () => ({
      mode: bgMode,
      color: bgColor,
    }),
    [bgMode, bgColor],
  );
  const payload = {
    lat: center.lat,
    lon: center.lon,
    size_km: sizeKm,
    theme,
    overlays,
    palette: paletteEnabled ? palette : undefined,
    pcaScheme: paletteEnabled ? palette : undefined,
    indexPack: theme === "index_triplet" ? indexPack : undefined,
    overlayStyles,
    background: backgroundConfig,
  };

  useEffect(
    () => () => {
      if (previewClickRef.current) {
        clearTimeout(previewClickRef.current);
      }
    },
    [],
  );

  const runPreview = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const result = await fetchPreview(payload);
      setPreview({ image: result.png_base64, bbox: result.bbox, scene: result.scene_metadata });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Preview failed");
    } finally {
      setLoading(false);
    }
  };

  const handlePreviewClick = () => {
    if (previewClickRef.current) {
      clearTimeout(previewClickRef.current);
    }
    previewClickRef.current = setTimeout(() => {
      previewClickRef.current = null;
      runPreview();
    }, 250);
  };

  const runExport = async () => {
    setExporting(true);
    setMessage("Rendering export…");
    try {
      const preferredBounds = preview.bbox ?? mapBounds ?? bboxFromCenter(center.lat, center.lon, sizeKm);
      const exportCenterLat = (preferredBounds[1] + preferredBounds[3]) / 2;
      const exportCenterLon = (preferredBounds[0] + preferredBounds[2]) / 2;
      const latKm = Math.abs(preferredBounds[3] - preferredBounds[1]) * 111;
      const lonKm = Math.abs(preferredBounds[2] - preferredBounds[0]) * 111 * Math.cos((exportCenterLat * Math.PI) / 180);
      const exportSizeKm = Math.max(latKm, lonKm, 1);
      const exportPayload = {
        lat: exportCenterLat,
        lon: exportCenterLon,
        size_km: exportSizeKm,
        theme,
        overlays,
        target_size_px: 4096,
        palette: paletteEnabled ? palette : undefined,
        pcaScheme: paletteEnabled ? palette : undefined,
        indexPack: theme === "index_triplet" ? indexPack : undefined,
        overlayStyles,
        background: backgroundConfig,
      };
      const blob = await exportImage(exportPayload);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `earth-art-${theme}.png`;
      link.click();
      URL.revokeObjectURL(url);
      setMessage("Export ready.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <main className="page">
      <section className="controls">
        <h1>Earth Art</h1>
        <p className="subtitle">Select a place, pick a spectral theme, and create artful remote sensing exports.</p>
        <SearchBar
          onSelect={(lat, lon, label) => {
            setCenter({ lat, lon });
            setPreview({});
            setMessage(`Focused on ${label}`);
          }}
        />
        <div className="size-picker">
          <p>Area size (km)</p>
          <div className="preset-group">
            {sizePresets.map((option) => (
              <button key={option} className={option === sizeKm ? "active" : ""} onClick={() => setSizeKm(option)}>
                {option} km
              </button>
            ))}
          </div>
        </div>
        <ThemePicker
          theme={theme}
          onChange={(next) => {
            setTheme(next);
            if (next !== "index_triplet") {
              setIndexPack("veg");
            }
          }}
        />
        {paletteAwareThemes.includes(theme) && <PalettePicker palette={palette} onChange={setPalette} />}
        {theme === "index_triplet" && <IndexPackPicker value={indexPack} onChange={setIndexPack} />}
        <div className="style-card">
          <p className="card-title">Road styling</p>
          <div className="style-row">
            <label>
              Color
              <input type="color" value={roadColor} onChange={(e) => setRoadColor(e.target.value)} />
            </label>
            <label>
              Width {roadWidth.toFixed(0)} px
              <input
                type="range"
                min={1}
                max={8}
                step={1}
                value={roadWidth}
                onChange={(e) => setRoadWidth(Number(e.target.value))}
              />
            </label>
            <label>
              Opacity {(roadOpacity * 100).toFixed(0)}%
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={roadOpacity}
                onChange={(e) => setRoadOpacity(Number(e.target.value))}
              />
            </label>
          </div>
        </div>
        <div className="style-card">
          <p className="card-title">Building styling</p>
          <div className="style-row">
            <label>
              Color
              <input type="color" value={buildingColor} onChange={(e) => setBuildingColor(e.target.value)} />
            </label>
            <label>
              Outline {buildingOutline.toFixed(1)} px
              <input
                type="range"
                min={0}
                max={3}
                step={0.5}
                value={buildingOutline}
                onChange={(e) => setBuildingOutline(Number(e.target.value))}
              />
            </label>
            <label>
              Outline opacity {(buildingOpacity * 100).toFixed(0)}%
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={buildingOpacity}
                onChange={(e) => setBuildingOpacity(Number(e.target.value))}
              />
            </label>
            <label>
              Fill opacity {(buildingFillOpacity * 100).toFixed(0)}%
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={buildingFillOpacity}
                onChange={(e) => setBuildingFillOpacity(Number(e.target.value))}
              />
            </label>
          </div>
        </div>
        <div className="style-card">
          <p className="card-title">Background</p>
          <div className="background-modes">
            <label>
              <input type="radio" name="bg-mode" checked={bgMode === "imagery"} onChange={() => setBgMode("imagery")} />
              Imagery
            </label>
            <label>
              <input type="radio" name="bg-mode" checked={bgMode === "solid"} onChange={() => setBgMode("solid")} />
              Solid
            </label>
            {bgMode === "solid" && (
              <label className="background-color">
                Color
                <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} />
              </label>
            )}
          </div>
        </div>
        <div className="style-card">
          <p className="card-title">Map basemap</p>
          <div className="background-modes">
            <label>
              <input
                type="radio"
                name="map-style"
                checked={basemapMode === "imagery"}
                onChange={() => setBasemapMode("imagery")}
              />
              Imagery
            </label>
            <label>
              <input
                type="radio"
                name="map-style"
                checked={basemapMode === "vector"}
                onChange={() => setBasemapMode("vector")}
              />
              Basic
            </label>
          </div>
        </div>
        <OverlayToggles overlays={overlays} onChange={setOverlays} />
        <label className="selection-toggle">
          <input type="checkbox" checked={showSelection} onChange={(e) => setShowSelection(e.target.checked)} />
          Show selection box
        </label>
        <div className="actions">
          <button onClick={handlePreviewClick} disabled={loading}>
            {loading ? "Rendering…" : "Preview"}
          </button>
          <button onClick={runExport} disabled={exporting || loading}>
            {exporting ? "Exporting…" : "Export 4K"}
          </button>
        </div>
        {message && <p className="hint">{message}</p>}
      </section>
      <section className="preview-section">
        <PreviewPane
          center={center}
          bbox={bbox}
          previewBase64={preview.image}
          loading={loading}
          sceneInfo={preview.scene}
          showSelection={showSelection}
          basemap={basemapMode}
          onBoundsChange={setMapBounds}
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
        h1 {
          margin: 0;
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
        .selection-toggle {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          color: #cbd5f5;
          font-size: 0.9rem;
        }
        .style-card {
          padding: 0.75rem 0.85rem;
          border-radius: 12px;
          background: rgba(15, 23, 42, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.05);
        }
        .card-title {
          margin: 0 0 0.35rem;
          font-weight: 600;
          color: #cbd5f5;
        }
        .style-row {
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
        }
        .style-row label {
          display: flex;
          flex-direction: column;
          gap: 0.1rem;
          font-size: 0.85rem;
        }
        .style-row input[type='color'] {
          width: 100%;
          height: 32px;
          border: none;
          background: transparent;
        }
        .style-row input[type='range'] {
          width: 100%;
        }
        .background-modes {
          display: flex;
          flex-wrap: wrap;
          gap: 0.6rem;
          align-items: center;
        }
        .background-modes label {
          display: flex;
          align-items: center;
          gap: 0.35rem;
          font-size: 0.9rem;
        }
        .background-color {
          flex: 1;
        }
        .actions {
          display: flex;
          gap: 0.75rem;
        }
        .actions button {
          flex: 1;
          padding: 0.75rem;
          border-radius: 999px;
          border: none;
          background: #10b981;
          color: #04211a;
          font-weight: 600;
        }
        .actions button:last-child {
          background: #f97316;
          color: #1b0d04;
        }
        .hint {
          color: #fda4af;
        }
        @media (max-width: 1024px) {
          .page {
            grid-template-columns: 1fr;
            gap: 1.5rem;
          }
          .preview-section {
            min-height: 70vh;
          }
        }
        @media (max-width: 640px) {
          .page {
            padding: 1.5rem;
          }
        }
      `}</style>
    </main>
  );
}
