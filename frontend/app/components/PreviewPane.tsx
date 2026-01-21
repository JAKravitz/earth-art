"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type Map, type StyleSpecification, type ImageSource as MapImageSource } from "maplibre-gl";

type BasemapMode = "imagery" | "vector";
type AoiRect = { x: number; y: number; width: number; height: number };
type AoiBounds = { west: number; south: number; east: number; north: number };

interface Props {
  selectedSizeKm?: number;
  sizeCommand?: number | null;
  drawCommand?: number;
  clearCommand?: number;
  flyToTarget?: { lat: number; lon: number; token: number } | null;
  previewImageUrl?: string | null;
  previewBounds?: [number, number, number, number] | null;
  presetBounds?: [number, number, number, number] | null;
  presetAspect?: number | null;
  activePresetId?: string | null;
  loading: boolean;
  sceneInfo?: Record<string, unknown>;
  showSelection: boolean;
  basemap: BasemapMode;
  onAoiBoundsChange?: (bbox: [number, number, number, number] | null) => void;
  onBoundsChange?: (bbox: [number, number, number, number]) => void;
  onMapCenterChange?: (center: { lat: number; lon: number; zoom: number }) => void;
  onFlyComplete?: () => void;
  onClearPreview?: () => void;
  onSizeCommandHandled?: () => void;
}

const DEFAULT_VIEW: ViewState = { latitude: 32.7157, longitude: -117.1611, zoom: 8 };

const BASEMAP_STYLES: Record<BasemapMode, StyleSpecification | string> = {
  imagery: {
    version: 8,
    sources: {
      "esri-world-imagery": {
        type: "raster",
        tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
        tileSize: 256,
        attribution:
          "Source: Esri, Maxar, Earthstar Geographics, CNES/Airbus DS, USDA, USGS, AeroGRID, IGN, GIS User Community",
      },
    },
    layers: [
      {
        id: "esri-world-imagery",
        type: "raster",
        source: "esri-world-imagery",
        minzoom: 0,
        maxzoom: 22,
      },
    ],
  },
  vector: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
};

const PREVIEW_SOURCE_ID = "preview-image-source";
const PREVIEW_LAYER_ID = "preview-image-layer";

const PreviewPane = ({
  flyToTarget,
  previewImageUrl,
  previewBounds,
  presetBounds,
  presetAspect,
  activePresetId,
  loading,
  sceneInfo,
  showSelection,
  basemap,
  onAoiBoundsChange,
  onBoundsChange,
  onMapCenterChange,
  onFlyComplete,
}: Props) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapCanvasRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const basemapRef = useRef<BasemapMode>(basemap);
  const viewStateRef = useRef<ViewState>({ latitude: DEFAULT_VIEW.latitude, longitude: DEFAULT_VIEW.longitude, zoom: DEFAULT_VIEW.zoom });
  const aoiRectRef = useRef<AoiRect | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [aoiRect, setAoiRect] = useState<AoiRect | null>(null);
  const flyTokenRef = useRef<number | null>(null);
  const lastBboxRef = useRef<[number, number, number, number] | null>(null);
  const lastReportedBoundsRef = useRef<[number, number, number, number] | null>(null);
  const aoiActiveRef = useRef(false);
  const hasFitRef = useRef(false);
  const targetAspectRef = useRef(1);
  const lastFitAspectRef = useRef(1);
  const prevPresetIdRef = useRef<string | null>(null);
  const handleMapMoveRef = useRef<(() => void) | null>(null);
  const updateAoiBoundsFromRectRef = useRef<typeof updateAoiBoundsFromRect | null>(null);

  const previewBoundsObj = useMemo(() => {
    if (!previewBounds) return null;
    const [west, south, east, north] = previewBounds;
    return { west, south, east, north };
  }, [previewBounds]);

  const presetBoundsObj = useMemo(() => {
    if (!presetBounds) return null;
    return {
      west: presetBounds[0],
      south: presetBounds[1],
      east: presetBounds[2],
      north: presetBounds[3],
    };
  }, [presetBounds?.[0], presetBounds?.[1], presetBounds?.[2], presetBounds?.[3]]);

  const aoiActive = useMemo(() => Boolean(presetBoundsObj), [presetBoundsObj]);
  const activeBounds = useMemo(() => (aoiActive ? previewBoundsObj ?? presetBoundsObj : null), [aoiActive, presetBoundsObj, previewBoundsObj]);

  const removePreviewLayer = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    if (map.getLayer(PREVIEW_LAYER_ID)) {
      map.removeLayer(PREVIEW_LAYER_ID);
    }
    if (map.getSource(PREVIEW_SOURCE_ID)) {
      map.removeSource(PREVIEW_SOURCE_ID);
    }
  }, []);

  const computeViewfinderRect = useCallback(
    (aspect: number): AoiRect | null => {
    const container = mapContainerRef.current;
    if (!container) return null;
    const width = container.clientWidth || 0;
    const height = container.clientHeight || 0;
    if (width === 0 || height === 0) return null;
    const maxWidth = width * 0.75;
    const maxHeight = height * 0.75;
    let rectWidth = maxWidth;
    let rectHeight = rectWidth / Math.max(aspect, 0.001);
    if (rectHeight > maxHeight) {
      rectHeight = maxHeight;
      rectWidth = rectHeight * aspect;
    }
    const x = (width - rectWidth) / 2;
    const y = (height - rectHeight) / 2;
    return { x, y, width: rectWidth, height: rectHeight };
  },
    [],
  );

  const updateAoiRect = useCallback(() => {
    const rect = computeViewfinderRect(targetAspectRef.current);
    if (!rect) return;
    console.log("[PreviewPane] setAoiRect", rect);
    setAoiRect((prev) => {
      if (prev && prev.x === rect.x && prev.y === rect.y && prev.width === rect.width && prev.height === rect.height) {
        return prev;
      }
      return rect;
    });
    aoiRectRef.current = rect;
    return rect;
  }, [computeViewfinderRect]);

  const updateAoiBoundsFromRect = useCallback(
    (rectOverride?: AoiRect | null) => {
      console.log("[PreviewPane] updateAoiBoundsFromRect called", { rect: rectOverride ?? aoiRectRef.current, mapReady });
      if (!aoiActiveRef.current) return;
      const map = mapRef.current;
      const rect = rectOverride ?? aoiRectRef.current;
      if (!map || !rect) return;
      const topLeft = map.unproject([rect.x, rect.y]);
      const bottomRight = map.unproject([rect.x + rect.width, rect.y + rect.height]);
      const bbox: [number, number, number, number] = [topLeft.lng, bottomRight.lat, bottomRight.lng, topLeft.lat];
      const last = lastBboxRef.current;
      if (!last || last.some((v, idx) => v !== bbox[idx])) {
        lastBboxRef.current = bbox;
        if (onAoiBoundsChange) onAoiBoundsChange(bbox);
      }
    },
    [onAoiBoundsChange],
  );
  useEffect(() => {
    updateAoiBoundsFromRectRef.current = updateAoiBoundsFromRect;
  }, [updateAoiBoundsFromRect]);

  const handleMapMove = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const center = map.getCenter();
    const zoom = map.getZoom();
    viewStateRef.current = { latitude: center.lat, longitude: center.lng, zoom };
    console.log("[PreviewPane] moveend", {
      center: { lat: center.lat, lon: center.lng },
      zoom,
      aoiActive: aoiActiveRef.current,
    });
    if (onBoundsChange) {
      const b = map.getBounds();
      const bbox: [number, number, number, number] = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
      const last = lastReportedBoundsRef.current;
      if (!last || last.some((v, idx) => v !== bbox[idx])) {
        lastReportedBoundsRef.current = bbox;
        onBoundsChange(bbox);
      }
    }
    if (!aoiActiveRef.current && onMapCenterChange) {
      onMapCenterChange({ lat: center.lat, lon: center.lng, zoom });
    }
  }, [onBoundsChange, onMapCenterChange]);
  useEffect(() => {
    handleMapMoveRef.current = handleMapMove;
  }, [handleMapMove]);

  useEffect(() => {
    aoiRectRef.current = aoiRect;
  }, [aoiRect]);

  const setInteractionMode = useCallback((mode: "free" | "framing") => {
    const map = mapRef.current;
    if (!map) return;
    if (mode === "free") {
      map.dragPan.enable();
      map.scrollZoom.enable();
      map.doubleClickZoom.enable();
      map.touchZoomRotate.enable();
      map.boxZoom.enable();
    } else {
      map.dragPan.enable();
      map.scrollZoom.disable();
      map.doubleClickZoom.disable();
      map.touchZoomRotate.disable();
      map.boxZoom.disable();
    }
  }, []);

  const syncInteractionMode = useCallback(() => {
    if (aoiActiveRef.current) {
      setInteractionMode("framing");
    } else {
      setInteractionMode("free");
    }
  }, [setInteractionMode]);

  useEffect(() => {
    const container = mapCanvasRef.current;
    if (!container) return;
    if (mapRef.current) return; // prevents remounting on prop change
    const initialCenter: [number, number] = flyToTarget
      ? [flyToTarget.lon, flyToTarget.lat]
      : [viewStateRef.current.longitude, viewStateRef.current.latitude];
    const initialZoom = flyToTarget ? viewStateRef.current.zoom : DEFAULT_VIEW.zoom;
    console.log("[PreviewPane] Creating MapLibre map", { center: initialCenter, zoom: initialZoom });
    const map = new maplibregl.Map({
      container,
      style: BASEMAP_STYLES[basemapRef.current],
      center: initialCenter,
      zoom: initialZoom,
      fadeDuration: 0,
    });
    mapRef.current = map;
    (window as any).__MAP = map;

    const handleViewChange = () => {
      if (!aoiActiveRef.current) return;
      updateAoiBoundsFromRectRef.current?.();
    };
    const handleResize = () => {
      if (!aoiActiveRef.current) return;
      const rect = updateAoiRect();
      updateAoiBoundsFromRectRef.current?.(rect);
    };
    const handleMoveEnd = () => {
      handleViewChange();
      handleMapMoveRef.current?.();
    };

    map.on("load", () => {
      setMapReady(true);
      map.dragPan.enable();
      map.scrollZoom.enable();
      map.doubleClickZoom.enable();
      map.touchZoomRotate.enable();
      map.boxZoom.enable();
      handleMapMoveRef.current?.();
      if (aoiActiveRef.current) {
        const rect = updateAoiRect();
        updateAoiBoundsFromRectRef.current?.(rect);
      }
      map.on("moveend", handleMoveEnd);
      map.on("zoom", handleViewChange);
      map.on("resize", handleResize);
    });

    return () => {
      console.log("[PreviewPane] Removing MapLibre map");
      map.off("moveend", handleMoveEnd);
      map.off("zoom", handleViewChange);
      map.off("resize", handleResize);
      map.remove();
      mapRef.current = null;
    };
  }, []); 

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;
    const incomingActive = Boolean(presetBoundsObj);
    const prevId = prevPresetIdRef.current;
    const presetChanged = activePresetId !== prevId;
    prevPresetIdRef.current = activePresetId || null;
    aoiActiveRef.current = incomingActive;

    if (incomingActive && presetBoundsObj && (presetChanged || !hasFitRef.current)) {
      console.log("[PreviewPane] AOI ACTIVATED", { presetId: activePresetId, presetBounds: presetBoundsObj });
      const aspect = presetAspect ?? 1;
      targetAspectRef.current = Math.max(0.2, Math.min(5, aspect));
      lastFitAspectRef.current = targetAspectRef.current;
      hasFitRef.current = true;
      console.log("[PreviewPane] hasFitRef set to", hasFitRef.current);
      setInteractionMode("framing");
      const rect = updateAoiRect();
      console.log("[PreviewPane] map.fitBounds called", {
        bounds: [
          [presetBoundsObj.west, presetBoundsObj.south],
          [presetBoundsObj.east, presetBoundsObj.north],
        ],
        reason: "AOI activation",
      });
      map.fitBounds(
        [
          [presetBoundsObj.west, presetBoundsObj.south],
          [presetBoundsObj.east, presetBoundsObj.north],
        ],
        { padding: 40, duration: 0 },
      );
      const rectForBounds = rect || updateAoiRect();
      updateAoiBoundsFromRect(rectForBounds);
      return;
    }

    if (!incomingActive && prevId) {
      console.log("[PreviewPane] AOI DEACTIVATED", { previousPresetId: prevId });
      aoiActiveRef.current = false;
      console.log("[PreviewPane] aoiActiveRef set to", aoiActiveRef.current);
      hasFitRef.current = false;
      lastBboxRef.current = null;
      setAoiRect(null);
      if (onAoiBoundsChange) onAoiBoundsChange(null);
      setInteractionMode("free");
    }
  }, [activePresetId, mapReady, onAoiBoundsChange, presetAspect, presetBoundsObj, setInteractionMode, updateAoiBoundsFromRect, updateAoiRect]);

  const applyPreviewLayer = useCallback(() => {
    const map = mapRef.current;
    if (!map || !previewImageUrl || !activeBounds) return;
    console.log("[PreviewPane] applyPreviewLayer", { activeBounds });
    const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
      [activeBounds.west, activeBounds.north],
      [activeBounds.east, activeBounds.north],
      [activeBounds.east, activeBounds.south],
      [activeBounds.west, activeBounds.south],
    ];
    const existing = map.getSource(PREVIEW_SOURCE_ID) as MapImageSource | undefined;
    if (existing && existing.type === "image") {
      existing.updateImage({ url: previewImageUrl, coordinates });
    } else {
      removePreviewLayer();
      map.addSource(PREVIEW_SOURCE_ID, {
        type: "image",
        url: previewImageUrl,
        coordinates,
      });
      map.addLayer({
        id: PREVIEW_LAYER_ID,
        type: "raster",
        source: PREVIEW_SOURCE_ID,
        paint: { "raster-opacity": 1 },
      });
    }
  }, [activeBounds, previewImageUrl, removePreviewLayer]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!previewImageUrl || !activeBounds) {
      removePreviewLayer();
      return;
    }
    if (!map.isStyleLoaded()) {
      const handler = () => applyPreviewLayer();
      map.once("styledata", handler);
      return () => {
        map.off("styledata", handler);
      };
    }
    applyPreviewLayer();
  }, [activeBounds, applyPreviewLayer, previewImageUrl, removePreviewLayer]);



  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !flyToTarget) return;

    // Prevent repeated recentering
    if (flyTokenRef.current === flyToTarget.token) return;
    flyTokenRef.current = flyToTarget.token;

    syncInteractionMode();

    console.log("[PreviewPane] map.easeTo called", {
      center: [flyToTarget?.lon, flyToTarget?.lat],
      zoom: flyToTarget.zoom ?? map.getZoom(),
      reason: "flyToTarget effect",
    });
    map.easeTo({
      center: [flyToTarget.lon, flyToTarget.lat],
      zoom: flyToTarget.zoom ?? map.getZoom(), // default to existing zoom
      duration: 0,
    });

    // After running flyTo ONCE, clear it so slingshot can't happen
    requestAnimationFrame(() => {
      flyTokenRef.current = flyToTarget.token;
      if (onFlyComplete) onFlyComplete();
    });
  }, [flyToTarget, mapReady, onFlyComplete, syncInteractionMode]);

  const aoiBorder = useMemo(() => {
    if (!aoiRect || !aoiActive) return null;
    return (
      <div
        className="aoi-border"
        style={{
          position: "absolute",
          left: aoiRect.x,
          top: aoiRect.y,
          width: aoiRect.width,
          height: aoiRect.height,
          border: showSelection ? "3px solid #ff4d4f" : "3px solid transparent",
          pointerEvents: "none",
          boxSizing: "border-box",
        }}
      />
    );
  }, [aoiRect, showSelection]);

  const vignette = useMemo(() => {
    if (!aoiRect || !mapContainerRef.current || !aoiActive) return null;
    const containerWidth = mapContainerRef.current.clientWidth || 0;
    const containerHeight = mapContainerRef.current.clientHeight || 0;
    const topHeight = Math.max(aoiRect.y, 0);
    const leftWidth = Math.max(aoiRect.x, 0);
    const bottomHeight = Math.max(containerHeight - (aoiRect.y + aoiRect.height), 0);
    const rightWidth = Math.max(containerWidth - (aoiRect.x + aoiRect.width), 0);
    const overlayStyle = { position: "absolute", background: "rgba(0,0,0,0.35)", pointerEvents: "none" as const };
    return (
      <>
        <div style={{ ...overlayStyle, top: 0, left: 0, right: 0, height: topHeight }} />
        <div style={{ ...overlayStyle, top: aoiRect.y, left: 0, width: leftWidth, height: aoiRect.height }} />
        <div
          style={{
            ...overlayStyle,
            top: aoiRect.y,
            left: aoiRect.x + aoiRect.width,
            width: rightWidth,
            height: aoiRect.height,
          }}
        />
        <div
          style={{
            ...overlayStyle,
            top: aoiRect.y + aoiRect.height,
            left: 0,
            right: 0,
            height: bottomHeight,
          }}
        />
      </>
    );
  }, [aoiRect]);

  return (
    <div className="map-wrapper" ref={mapContainerRef}>
      <div className="map-canvas" ref={mapCanvasRef} />
      {aoiBorder}
      {vignette}
      {sceneInfo && (
        <div className="meta-badge">
          <div>{String(sceneInfo["id"] ?? "")}</div>
          <div>Clouds: {String(sceneInfo["cloud_coverage"] ?? "-")}%</div>
        </div>
      )}
      {loading && <div className="loading-indicator">Rendering…</div>}
      <style jsx>{`
        .map-wrapper {
          position: relative;
          width: 100%;
          height: calc(100vh - 80px);
          min-height: 420px;
        }
        .map-canvas {
          position: absolute;
          inset: 0;
          border-radius: 20px;
          overflow: hidden;
          pointer-events: auto;
        }
        .meta-badge {
          position: absolute;
          bottom: 16px;
          left: 16px;
          background: rgba(5, 10, 25, 0.78);
          backdrop-filter: blur(10px);
          padding: 10px 14px;
          border-radius: 12px;
          font-size: 0.85rem;
          color: #e5e7eb;
          pointer-events: none;
        }
        .loading-indicator {
          position: absolute;
          top: 16px;
          right: 16px;
          background: rgba(15, 23, 42, 0.85);
          padding: 8px 12px;
          border-radius: 999px;
          font-size: 0.85rem;
          color: #f8fafc;
          pointer-events: none;
        }
        @media (max-width: 1024px) {
          .map-wrapper {
            height: 70vh;
          }
        }
      `}</style>
    </div>
  );
}

export default React.memo(PreviewPane);
