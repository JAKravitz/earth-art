"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { fetchRoadNetworkPreview, type RoadNetworkStyle } from "../../api";
import { ROAD_STYLE_CARDS } from "../styles";
import { useEarthsySession } from "../../context/EarthsySession";

const PREVIEW_LONG_SIDE = 1536;
const PREVIEW_ABORT_MS = 40000;
const DEFAULT_STYLE_ID: RoadNetworkStyle = ROAD_STYLE_CARDS[0].id;

type RenderStatus = "idle" | "loading" | "done" | "error";
type RenderMap = Record<RoadNetworkStyle, string>;
type RenderStatusMap = Record<RoadNetworkStyle, RenderStatus>;
type RenderErrorMap = Record<RoadNetworkStyle, string | null>;

const STYLE_IDS: RoadNetworkStyle[] = ROAD_STYLE_CARDS.map((card) => card.id);

const buildStatusMap = (value: RenderStatus): RenderStatusMap =>
  STYLE_IDS.reduce((acc, id) => {
    acc[id] = value;
    return acc;
  }, {} as RenderStatusMap);

const buildErrorMap = (): RenderErrorMap =>
  STYLE_IDS.reduce((acc, id) => {
    acc[id] = null;
    return acc;
  }, {} as RenderErrorMap);

function dimensionsFromBbox(bbox: [number, number, number, number], longSide: number) {
  const [west, south, east, north] = bbox;
  const centerLat = (south + north) / 2;
  const widthKm = Math.abs(east - west) * 111.32 * Math.cos((centerLat * Math.PI) / 180);
  const heightKm = Math.abs(north - south) * 110.574;
  const aspect = widthKm > 0 && heightKm > 0 ? widthKm / heightKm : 1;
  if (aspect >= 1) {
    return { width: longSide, height: Math.max(320, Math.round(longSide / aspect)) };
  }
  return { width: Math.max(320, Math.round(longSide * aspect)), height: longSide };
}

function bboxToPolygon(bbox: [number, number, number, number]) {
  const [west, south, east, north] = bbox;
  return {
    type: "Polygon",
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  };
}

function EditorInner() {
  const { aoiBounds, hydrated } = useEarthsySession();
  const [activeStyleId, setActiveStyleId] = useState<RoadNetworkStyle>(DEFAULT_STYLE_ID);
  const [renders, setRenders] = useState<RenderMap>({} as RenderMap);
  const [renderStatus, setRenderStatus] = useState<RenderStatusMap>(() => buildStatusMap("idle"));
  const [renderErrors, setRenderErrors] = useState<RenderErrorMap>(() => buildErrorMap());
  const requestTokenRef = useRef(0);
  const controllersRef = useRef<Map<RoadNetworkStyle, AbortController>>(new Map());
  const timeoutsRef = useRef<Map<RoadNetworkStyle, number>>(new Map());
  const rendersRef = useRef<RenderMap>({} as RenderMap);
  const mountedRef = useRef(false);

  const dimensions = useMemo(
    () => (aoiBounds ? dimensionsFromBbox(aoiBounds, PREVIEW_LONG_SIDE) : null),
    [aoiBounds],
  );
  const aoi = useMemo(() => (aoiBounds ? bboxToPolygon(aoiBounds) : null), [aoiBounds]);

  useEffect(() => {
    rendersRef.current = renders;
  }, [renders]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllersRef.current.forEach((controller) => controller.abort());
      controllersRef.current.clear();
      timeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      timeoutsRef.current.clear();
      Object.values(rendersRef.current).forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
    };
  }, []);

  const abortAll = useCallback(() => {
    controllersRef.current.forEach((controller) => controller.abort());
    controllersRef.current.clear();
    timeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    timeoutsRef.current.clear();
  }, []);

  const resetRenders = useCallback(() => {
    setRenders((prev) => {
      Object.values(prev).forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
      return {} as RenderMap;
    });
  }, []);

  const renderStyle = useCallback(
    async (styleId: RoadNetworkStyle, token: number) => {
      if (!aoi || !dimensions) return;
      setRenderStatus((prev) => ({ ...prev, [styleId]: "loading" }));
      setRenderErrors((prev) => ({ ...prev, [styleId]: null }));
      const controller = new AbortController();
      controllersRef.current.set(styleId, controller);
      const timeoutId = window.setTimeout(() => controller.abort(), PREVIEW_ABORT_MS);
      timeoutsRef.current.set(styleId, timeoutId);
      if (process.env.NODE_ENV !== "production") {
        console.time(`[Roads] render ${styleId}`);
      }
      try {
        const blob = await fetchRoadNetworkPreview(
          {
            aoi,
            style: styleId,
            width_px: dimensions.width,
            height_px: dimensions.height,
          },
          controller.signal,
        );
        if (!mountedRef.current || requestTokenRef.current !== token) return;
        const url = URL.createObjectURL(blob);
        setRenders((prev) => {
          const existing = prev[styleId];
          if (existing) URL.revokeObjectURL(existing);
          return { ...prev, [styleId]: url };
        });
        setRenderStatus((prev) => ({ ...prev, [styleId]: "done" }));
      } catch (err) {
        if (!mountedRef.current || requestTokenRef.current !== token) return;
        const message =
          err instanceof DOMException && err.name === "AbortError"
            ? "Preview timed out. Try a smaller AOI or retry."
            : err instanceof Error
              ? err.message
              : "Failed to render preview.";
        setRenderErrors((prev) => ({ ...prev, [styleId]: message }));
        setRenderStatus((prev) => ({ ...prev, [styleId]: "error" }));
      } finally {
        window.clearTimeout(timeoutId);
        controllersRef.current.delete(styleId);
        timeoutsRef.current.delete(styleId);
        if (process.env.NODE_ENV !== "production") {
          console.timeEnd(`[Roads] render ${styleId}`);
        }
      }
    },
    [aoi, dimensions],
  );

  useEffect(() => {
    if (!aoi || !dimensions) return;
    const token = ++requestTokenRef.current;
    abortAll();
    setActiveStyleId(DEFAULT_STYLE_ID);
    setRenderStatus(buildStatusMap("idle"));
    setRenderErrors(buildErrorMap());
    resetRenders();
    if (process.env.NODE_ENV !== "production") {
      console.log("[Roads] rendering styles", STYLE_IDS);
    }
    void Promise.allSettled(STYLE_IDS.map((id) => renderStyle(id, token)));
  }, [aoi, dimensions, abortAll, resetRenders, renderStyle]);

  useEffect(() => {
    if (renderStatus[activeStyleId] !== "error") return;
    const fallbackId = STYLE_IDS.find((id) => renderStatus[id] === "done");
    if (fallbackId && fallbackId !== activeStyleId) {
      setActiveStyleId(fallbackId);
    }
  }, [activeStyleId, renderStatus]);

  const firstDoneId = useMemo(() => STYLE_IDS.find((id) => renderStatus[id] === "done"), [renderStatus]);
  const displayStyleId = renderStatus[activeStyleId] === "done" ? activeStyleId : firstDoneId;
  const displayUrl = displayStyleId ? renders[displayStyleId] : null;
  const activeStatus = renderStatus[activeStyleId];
  const activeError = renderErrors[activeStyleId];
  const anyLoading = STYLE_IDS.some((id) => renderStatus[id] === "loading");

  if (!hydrated) {
    return <div style={{ padding: 24 }}>Loading editor…</div>;
  }

  if (!aoi || !dimensions) {
    return (
      <div className="empty">
        <h2>Pick an AOI first</h2>
        <p>Return to the playground to set your map framing.</p>
        <Link href="/roads/playground" className="primary">
          Back to roads playground
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
      <aside className="filters">
        <p className="eyebrow">Road Networks</p>
        <h2>Pick a style</h2>
        <div className="cards">
          {ROAD_STYLE_CARDS.map((card) => {
            const status = renderStatus[card.id];
            const url = renders[card.id];
            return (
              <button
                key={card.id}
                className={`style-card ${activeStyleId === card.id ? "active" : ""}`}
                onClick={() => setActiveStyleId(card.id)}
              >
                <div className="swatch">
                  {status === "loading" ? (
                    <div className="swatch-loading" />
                  ) : status === "error" ? (
                    <div className="swatch-error">!</div>
                  ) : url ? (
                    <img src={url} alt={card.name} />
                  ) : (
                    <div className="swatch-fill" style={{ background: card.accent }} />
                  )}
                </div>
                <div>
                  <div className="title">{card.name}</div>
                  <div className="desc">{card.description}</div>
                  {status === "loading" ? <span className="badge loading">Rendering</span> : null}
                  {status === "error" ? <span className="badge error">Failed</span> : null}
                </div>
              </button>
            );
          })}
        </div>
        <Link href="/roads/playground" className="ghost">
          Back to playground
        </Link>
        {activeError ? <p className="error">{activeError}</p> : null}
      </aside>
      <main className="canvas">
        <div className="header">
          <h1>Road Networks</h1>
          <p>
            {dimensions.width} x {dimensions.height}px preview
          </p>
        </div>
        <div className="image-frame">
          {displayUrl ? (
            <img src={displayUrl} alt="Road network preview" />
          ) : activeStatus === "error" ? (
            <div className="placeholder error">{activeError ?? "Failed to render preview."}</div>
          ) : (
            <div className="placeholder">Rendering…</div>
          )}
          {anyLoading && <div className="loading">Rendering preview…</div>}
        </div>
      </main>
      <style jsx>{`
        .editor {
          display: grid;
          grid-template-columns: 320px 1fr;
          min-height: calc(100vh - 72px);
        }
        .filters {
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
        .cards {
          display: grid;
          gap: 10px;
          margin-top: 6px;
        }
        .style-card {
          display: grid;
          grid-template-columns: 64px 1fr;
          gap: 10px;
          padding: 10px;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(255, 255, 255, 0.03);
          color: #e5e7eb;
          text-align: left;
        }
        .style-card.active {
          border-color: #2563eb;
          box-shadow: 0 12px 26px rgba(37, 99, 235, 0.25);
        }
        .swatch {
          border-radius: 10px;
          border: 1px solid rgba(255, 255, 255, 0.15);
          min-height: 48px;
          overflow: hidden;
          display: flex;
          align-items: stretch;
          justify-content: stretch;
        }
        .swatch img,
        .swatch-fill {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .swatch-loading {
          width: 100%;
          height: 100%;
          background: linear-gradient(
            110deg,
            rgba(255, 255, 255, 0.06) 8%,
            rgba(255, 255, 255, 0.18) 18%,
            rgba(255, 255, 255, 0.06) 33%
          );
          background-size: 200% 100%;
          animation: shimmer 1.1s ease-in-out infinite;
        }
        .swatch-error {
          width: 100%;
          height: 100%;
          display: grid;
          place-items: center;
          font-weight: 700;
          color: #fca5a5;
          background: rgba(239, 68, 68, 0.15);
        }
        .badge {
          display: inline-flex;
          align-items: center;
          margin-top: 6px;
          padding: 2px 8px;
          border-radius: 999px;
          font-size: 0.7rem;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          background: rgba(148, 163, 184, 0.2);
          color: #e2e8f0;
        }
        .badge.loading {
          background: rgba(59, 130, 246, 0.2);
          color: #bfdbfe;
        }
        .badge.error {
          background: rgba(248, 113, 113, 0.2);
          color: #fecaca;
        }
        .title {
          font-weight: 600;
        }
        .desc {
          color: #94a3b8;
          font-size: 0.85rem;
        }
        .ghost {
          margin-top: auto;
          text-decoration: none;
          color: #cbd5f5;
          border: 1px solid rgba(255, 255, 255, 0.12);
          padding: 10px 14px;
          border-radius: 10px;
          text-align: center;
        }
        .error {
          color: #f87171;
          margin: 0;
          font-size: 0.9rem;
        }
        .canvas {
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          height: calc(100vh - 72px);
          min-height: 0;
        }
        .header h1 {
          margin: 0 0 4px;
        }
        .header p {
          margin: 0;
          color: #94a3b8;
        }
        .image-frame {
          position: relative;
          flex: 1;
          min-height: 0;
          border-radius: 16px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(15, 23, 42, 0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }
        .image-frame img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          object-position: center;
          display: block;
        }
        .placeholder {
          color: #94a3b8;
        }
        .placeholder.error {
          color: #fca5a5;
          padding: 24px;
          text-align: center;
        }
        .loading {
          position: absolute;
          top: 16px;
          right: 16px;
          background: rgba(15, 23, 42, 0.85);
          padding: 8px 12px;
          border-radius: 999px;
          font-size: 0.85rem;
          color: #f8fafc;
        }
        @keyframes shimmer {
          0% {
            background-position: 0% 0%;
          }
          100% {
            background-position: -200% 0%;
          }
        }
        @media (max-width: 1024px) {
          .editor {
            grid-template-columns: 1fr;
          }
          .filters {
            border-right: none;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          }
        }
      `}</style>
    </div>
  );
}

export default function RoadNetworksEditor() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading editor…</div>}>
      <EditorInner />
    </Suspense>
  );
}
