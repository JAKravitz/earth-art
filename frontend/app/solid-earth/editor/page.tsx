"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getFilterById, getFiltersForTheme } from "../../config/themesAndFilters";
import { useEarthsySession } from "../../context/EarthsySession";
import { exportFilterImage } from "../../api";

function bboxWidthKm(bbox: [number, number, number, number]): number {
  const [w, s, e, n] = bbox;
  const centerLat = (s + n) / 2;
  return Math.abs(e - w) * 111 * Math.cos((centerLat * Math.PI) / 180);
}

export default function SolidEarthEditor() {
  const router = useRouter();
  const { previewsByFilterId, selectedFilterId, setSelectedFilterId, adjustments, setAdjustments, aoiBounds, center } =
    useEarthsySession();
  const filters = useMemo(() => getFiltersForTheme("earth-science"), []);
  const currentId = selectedFilterId || Object.keys(previewsByFilterId)[0] || filters[0]?.id;
  const currentPreview = currentId ? previewsByFilterId[currentId] : undefined;

  useEffect(() => {
    if (!Object.keys(previewsByFilterId).length) {
      router.push("/solid-earth/playground");
    }
  }, [previewsByFilterId, router]);

  useEffect(() => {
    if (!selectedFilterId && Object.keys(previewsByFilterId).length) {
      setSelectedFilterId(Object.keys(previewsByFilterId)[0]);
    }
  }, [previewsByFilterId, selectedFilterId, setSelectedFilterId]);

  const applyCssFilter = () => {
    const { brightness, contrast, saturation } = adjustments;
    return `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`;
  };

  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (!currentId || !aoiBounds) return;
    const filter = getFilterById(currentId);
    if (!filter) return;
    setExporting(true);
    try {
      const sizeKm = Math.max(1, bboxWidthKm(aoiBounds));
      const blob = await exportFilterImage({
        lat: center.lat,
        lon: center.lon,
        size_km: sizeKm,
        aoi_bounds: aoiBounds,
        filter: { id: filter.id, styleType: filter.styleType, params: filter.params },
        target_size_px: 4096,
        adjustments: {
          brightness: adjustments.brightness / 100,
          contrast: adjustments.contrast / 100,
          saturation: adjustments.saturation / 100,
        },
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `earthsy-${filter.id}.png`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="editor">
      <aside className="filters">
        <h3>Filters</h3>
        <div className="thumbs">
          {filters.map((f) => (
            <button key={f.id} className={`thumb ${currentId === f.id ? "active" : ""}`} onClick={() => setSelectedFilterId(f.id)}>
              <div className="mini">
                {previewsByFilterId[f.id]?.imageUrl ? (
                  <img src={previewsByFilterId[f.id].imageUrl} alt={f.name} />
                ) : (
                  <div className="placeholder" />
                )}
              </div>
              <span>{f.name}</span>
            </button>
          ))}
        </div>
      </aside>
      <main className="canvas">
        <h2>Solid Earth Editor</h2>
        <div className="image-frame">
          {currentPreview?.imageUrl ? (
            <img src={currentPreview.imageUrl} alt="AOI" style={{ filter: applyCssFilter() }} />
          ) : (
            <div className="placeholder">Load previews from playground</div>
          )}
        </div>
      </main>
      <aside className="controls">
        <h3>Adjustments</h3>
        {["brightness", "contrast", "saturation"].map((key) => (
          <label key={key}>
            {key.charAt(0).toUpperCase() + key.slice(1)} {adjustments[key as keyof typeof adjustments]}%
            <input
              type="range"
              min={50}
              max={200}
              value={adjustments[key as keyof typeof adjustments]}
              onChange={(e) => setAdjustments({ [key]: Number(e.target.value) } as any)}
            />
          </label>
        ))}
        <div className="buttons">
          <button className="primary" onClick={handleExport} disabled={exporting}>
            {exporting ? "Exporting…" : "Export high-resolution"}
          </button>
          <Link className="ghost" href="/solid-earth/playground">
            Back to playground
          </Link>
        </div>
      </aside>
      <style jsx>{`
        .editor {
          display: grid;
          grid-template-columns: 220px 1fr 280px;
          min-height: calc(100vh - 72px);
        }
        .filters {
          padding: 16px;
          background: rgba(255, 255, 255, 0.02);
          border-right: 1px solid rgba(255, 255, 255, 0.06);
        }
        .thumbs {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .thumb {
          display: flex;
          align-items: center;
          gap: 8px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 10px;
          padding: 8px;
          text-align: left;
          color: #e5e7eb;
        }
        .thumb.active {
          border-color: #2563eb;
        }
        .mini {
          width: 48px;
          height: 48px;
          border-radius: 8px;
          overflow: hidden;
          background: rgba(255, 255, 255, 0.04);
        }
        .mini img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .canvas {
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          align-items: center;
          justify-content: center;
        }
        .image-frame {
          width: min(90%, 900px);
          background: rgba(0, 0, 0, 0.4);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 14px;
          padding: 10px;
          min-height: 400px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .image-frame img {
          max-width: 100%;
          max-height: 80vh;
          border-radius: 12px;
        }
        .placeholder {
          color: #94a3b8;
        }
        .controls {
          padding: 16px;
          background: rgba(255, 255, 255, 0.02);
          border-left: 1px solid rgba(255, 255, 255, 0.06);
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        label {
          display: flex;
          flex-direction: column;
          color: #cbd5f5;
          gap: 4px;
        }
        input[type="range"] {
          width: 100%;
        }
        .buttons {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: auto;
        }
        .primary,
        .ghost {
          padding: 12px;
          border-radius: 10px;
          border: none;
          text-align: center;
          text-decoration: none;
        }
        .primary {
          background: linear-gradient(135deg, #2563eb, #7c3aed);
          color: #fff;
        }
        .ghost {
          color: #cbd5f5;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
      `}</style>
    </div>
  );
}
