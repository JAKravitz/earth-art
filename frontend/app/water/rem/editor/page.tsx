"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { remPreview, remExport } from "../../../api";
import { useEarthsySession } from "../../../context/EarthsySession";

const PREVIEW_SIZE_PX = 1024;
const EXPORT_SIZE_PX = 4096;
const PREVIEW_ABORT_MS = 300000; // 5 min – REM generation can be slow

const COLORMAP_OPTIONS = [
  { id: "topo", label: "Topo" },
  { id: "mako_r", label: "Mako (reversed)" },
  { id: "viridis", label: "Viridis" },
  { id: "terrain", label: "Terrain" },
];

export default function REMEditorPage() {
  const router = useRouter();
  const { aoiBounds, center, hydrated } = useEarthsySession();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [colormap, setColormap] = useState("topo");
  const [exporting, setExporting] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const previewUrlRef = useRef<string | null>(null);

  const fetchPreview = useCallback(async () => {
    if (!aoiBounds) return;
    setPreviewLoading(true);
    setPreviewError(null);
    if (controllerRef.current) controllerRef.current.abort();
    controllerRef.current = new AbortController();
    const token = controllerRef.current.signal;
    const timeoutId = window.setTimeout(() => controllerRef.current?.abort(), PREVIEW_ABORT_MS);
    try {
      const blob = await remPreview(
        {
          bbox: aoiBounds,
          target_size_px: PREVIEW_SIZE_PX,
          colormap,
        },
        token,
      );
      if (!mountedRef.current) return;
      const url = URL.createObjectURL(blob);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = url;
      setPreviewUrl(url);
    } catch (err) {
      if (!mountedRef.current) return;
      const message =
        err instanceof DOMException && err.name === "AbortError"
          ? "Preview timed out. Try a smaller area or retry. If you just retried, wait a minute—the server may still be finishing the previous request."
          : err instanceof Error && (err.message === "Failed to fetch" || err.name === "TypeError")
            ? "Connection lost or server busy. Wait a moment, then use Retry below or pick a smaller area."
            : err instanceof Error
              ? err.message
              : "Failed to load REM preview.";
      setPreviewError(message);
      setPreviewUrl(null);
    } finally {
      window.clearTimeout(timeoutId);
      setPreviewLoading(false);
      controllerRef.current = null;
    }
  }, [aoiBounds, colormap]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (controllerRef.current) controllerRef.current.abort();
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!aoiBounds) return;
    void fetchPreview();
  }, [aoiBounds, colormap, fetchPreview]);

  useEffect(() => {
    if (!hydrated || aoiBounds) return;
    router.replace("/water/rem/playground");
  }, [hydrated, aoiBounds, router]);

  const handleExport = async () => {
    if (!aoiBounds) return;
    setExporting(true);
    try {
      const blob = await remExport({
        bbox: aoiBounds,
        target_size_px: EXPORT_SIZE_PX,
        colormap,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "river-rem.png";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      setPreviewError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  if (!hydrated) {
    return (
      <div style={{ padding: 24 }}>Loading editor…</div>
    );
  }

  if (!aoiBounds) {
    return (
      <div className="empty">
        <h2>Pick an area first</h2>
        <p>Return to the playground to choose a river and AOI.</p>
        <Link href="/water/rem/playground" className="primary">
          Back to River REM playground
        </Link>
        <style jsx>{`
          .empty {
            padding: 40px;
            text-align: center;
          }
          .primary {
            display: inline-flex;
            padding: 12px 18px;
            border-radius: 10px;
            background: linear-gradient(135deg, #2563eb, #7c3aed);
            color: #fff;
            text-decoration: none;
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="editor">
      <aside className="sidebar">
        <p className="eyebrow">River REM</p>
        <h2>Preview & export</h2>
        <Link href="/water/rem/playground" className="back-link">
          Back to playground
        </Link>
        <div className="section">
          <p className="section-title">Colormap</p>
          <div className="colormap-list">
            {COLORMAP_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`preset-card ${colormap === opt.id ? "active" : ""}`}
                onClick={() => setColormap(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <p className="about-rem">
          REMs show height above the river (0 = water surface). Best for meandering rivers; steep gradients, dams, or braided channels may reduce accuracy.{" "}
          <a href="https://dancoecarto.com/creating-rems-in-qgis-the-idw-method" target="_blank" rel="noopener noreferrer">Tutorials (Dan Coe)</a>
        </p>
        {previewError ? (
          <div className="error-block">
            <p className="error">{previewError}</p>
            <button
              type="button"
              className="retry-btn"
              disabled={previewLoading}
              onClick={() => {
                setPreviewError(null);
                void fetchPreview();
              }}
            >
              Retry
            </button>
          </div>
        ) : null}
        <button
          type="button"
          className="primary export-btn"
          disabled={exporting || previewLoading}
          onClick={handleExport}
        >
          {exporting ? "Exporting…" : "Export high-resolution"}
        </button>
      </aside>
      <div className="preview-area">
        {previewLoading && !previewUrl ? (
          <div className="loading">Generating REM preview…</div>
        ) : previewUrl ? (
          <img src={previewUrl} alt="REM preview" className="preview-img" />
        ) : previewError ? (
          <div className="loading error-msg">{previewError}</div>
        ) : null}
      </div>
      <style jsx>{`
        .editor {
          display: grid;
          grid-template-columns: 320px minmax(0, 1fr);
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
        .back-link {
          color: #94a3b8;
          font-size: 0.9rem;
          text-decoration: none;
          margin-bottom: 8px;
        }
        .back-link:hover {
          color: #cbd5e1;
        }
        .eyebrow {
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-size: 0.8rem;
          color: #94a3b8;
          margin: 0;
        }
        h2 {
          margin: 0;
        }
        .section {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .section-title {
          margin: 0;
          font-size: 0.85rem;
          color: #94a3b8;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .about-rem {
          margin: 0;
          font-size: 0.8rem;
          color: #64748b;
          line-height: 1.4;
        }
        .about-rem a {
          color: #94a3b8;
          text-decoration: none;
        }
        .about-rem a:hover {
          text-decoration: underline;
        }
        .colormap-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .preset-card {
          padding: 8px 14px;
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(255, 255, 255, 0.03);
          color: #e5e7eb;
          cursor: pointer;
          font-size: 0.9rem;
        }
        .preset-card.active {
          border-color: #2563eb;
          background: rgba(37, 99, 235, 0.15);
        }
        .error-block {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .error {
          color: #f87171;
          margin: 0;
          font-size: 0.9rem;
        }
        .retry-btn {
          align-self: flex-start;
          padding: 8px 14px;
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.2);
          background: rgba(255, 255, 255, 0.06);
          color: #e5e7eb;
          cursor: pointer;
          font-size: 0.9rem;
        }
        .retry-btn:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.1);
        }
        .retry-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .primary {
          margin-top: auto;
          padding: 12px 14px;
          border: none;
          border-radius: 10px;
          background: linear-gradient(135deg, #2563eb, #7c3aed);
          color: #fff;
          font-weight: 700;
          cursor: pointer;
        }
        .primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .preview-area {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background: rgba(0, 0, 0, 0.3);
          min-height: 400px;
        }
        .preview-img {
          max-width: 100%;
          max-height: calc(100vh - 120px);
          width: auto;
          height: auto;
          object-fit: contain;
        }
        .loading {
          color: #94a3b8;
          padding: 40px;
        }
        .error-msg {
          color: #f87171;
        }
      `}</style>
    </div>
  );
}
