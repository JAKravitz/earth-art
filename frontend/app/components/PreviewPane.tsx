"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type Map, type StyleSpecification, type ImageSource as MapImageSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type BasemapMode = "imagery" | "vector";
type ViewState = { latitude: number; longitude: number; zoom: number };

type AoiRect = { x: number; y: number; width: number; height: number };
type AoiBounds = { west: number; south: number; east: number; north: number };

interface Props {
  selectedSizeKm: number;
  sizeCommand: number | null;
  drawCommand: number;
  clearCommand: number;
  flyToTarget?: { lat: number; lon: number; token: number } | null;
  previewImageUrl?: string | null;
  loading: boolean;
  sceneInfo?: Record<string, unknown>;
  showSelection: boolean;
  basemap: BasemapMode;
  onBoundsChange?: (bbox: [number, number, number, number]) => void;
  onAoiBoundsChange?: (bbox: [number, number, number, number] | null) => void;
  onClearPreview?: () => void;
  onSizeCommandHandled?: () => void;
}

const DEFAULT_VIEW: ViewState = { latitude: 32.7157, longitude: -117.1611, zoom: 8 };
const EARTH_RADIUS_M = 6378137;

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

function kmToZoom(widthKm: number, mapWidthPx: number, latitude: number): number {
  const widthM = widthKm * 1000;
  const metersPerPixel = widthM / Math.max(mapWidthPx, 1);
  const latRad = (latitude * Math.PI) / 180;
  const numerator = Math.cos(latRad) * 2 * Math.PI * EARTH_RADIUS_M;
  const zoom = Math.log2(numerator / (metersPerPixel * 256));
  return Math.max(0, Math.min(22, zoom));
}

export default function PreviewPane({
  selectedSizeKm,
  sizeCommand,
  drawCommand,
  clearCommand,
  flyToTarget,
  previewImageUrl,
  loading,
  sceneInfo,
  showSelection,
  basemap,
  onBoundsChange,
  onAoiBoundsChange,
  onClearPreview,
  onSizeCommandHandled,
}: Props) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapCanvasRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const basemapRef = useRef<BasemapMode>(basemap);
  const [viewState, setViewState] = useState<ViewState>(DEFAULT_VIEW);
  const viewStateRef = useRef<ViewState>(DEFAULT_VIEW);
  const aoiRectRef = useRef<AoiRect | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [aoiRect, setAoiRect] = useState<AoiRect | null>(null);
  const [latestBounds, setLatestBounds] = useState<AoiBounds | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const flyTokenRef = useRef<number | null>(null);

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

  const pushBounds = useCallback(
    (bounds: AoiBounds | null) => {
      setLatestBounds(bounds);
      if (onAoiBoundsChange) {
        onAoiBoundsChange(bounds ? [bounds.west, bounds.south, bounds.east, bounds.north] : null);
      }
    },
    [onAoiBoundsChange],
  );

  const clearAoi = useCallback(
    (reason: string) => {
      console.log("[PreviewPane] AOI cleared:", reason);
      setAoiRect(null);
      pushBounds(null);
      dragStartRef.current = null;
      removePreviewLayer();
      if (onClearPreview) onClearPreview();
    },
    [onClearPreview, pushBounds, removePreviewLayer],
  );

  const computeBounds = useCallback(
    (rect: AoiRect | null): AoiBounds | null => {
      if (!rect || !mapRef.current) return null;
      const topLeft = mapRef.current.unproject([rect.x, rect.y]);
      const bottomRight = mapRef.current.unproject([rect.x + rect.width, rect.y + rect.height]);
      return {
        west: topLeft.lng,
        south: bottomRight.lat,
        east: bottomRight.lng,
        north: topLeft.lat,
      };
    },
    [],
  );


  const syncViewFromMap = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const center = map.getCenter();
    const zoom = map.getZoom();
    setViewState({ latitude: center.lat, longitude: center.lng, zoom });
    viewStateRef.current = { latitude: center.lat, longitude: center.lng, zoom };
  }, []);

  const handleMapMove = useCallback(
    (evt: maplibregl.MapboxEvent<MouseEvent | TouchEvent | WheelEvent> & maplibregl.EventData) => {
      const { lat, lng } = evt.target.getCenter();
      const zoom = evt.target.getZoom();
      setViewState({ latitude: lat, longitude: lng, zoom });
      viewStateRef.current = { latitude: lat, longitude: lng, zoom };
    },
    [],
  );

  useEffect(() => {
    viewStateRef.current = viewState;
  }, [viewState]);

  useEffect(() => {
    aoiRectRef.current = aoiRect;
  }, [aoiRect]);

  const applyFlyTo = useCallback(() => {
    if (!mapRef.current || !flyToTarget) return;
    const map = mapRef.current;
    flyTokenRef.current = flyToTarget.token;
    setViewState((prev) => ({ ...prev, latitude: flyToTarget.lat, longitude: flyToTarget.lon }));
    map.easeTo({
      center: [flyToTarget.lon, flyToTarget.lat],
      zoom: viewState.zoom,
      duration: 0,
    });
  }, [flyToTarget, viewState.zoom]);

  useEffect(() => {
    if (!mapCanvasRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapCanvasRef.current,
      style: BASEMAP_STYLES[basemap],
      center: [DEFAULT_VIEW.longitude, DEFAULT_VIEW.latitude],
      zoom: DEFAULT_VIEW.zoom,
      fadeDuration: 0,
    });
    mapRef.current = map;

    map.on("load", () => {
      if (onBoundsChange) {
        const b = map.getBounds();
        onBoundsChange([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
      }
      syncViewFromMap();
    });
    map.on("move", handleMapMove);
    map.on("moveend", () => {
      if (onBoundsChange) {
        const b = map.getBounds();
        onBoundsChange([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
      }
      const rect = aoiRectRef.current;
      if (rect && !previewImageUrl) {
        const bounds = computeBounds(rect);
        if (bounds) pushBounds(bounds);
      }
    });
  }, [basemap, computeBounds, handleMapMove, onBoundsChange, previewImageUrl, pushBounds, syncViewFromMap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (basemapRef.current === basemap) return;
    basemapRef.current = basemap;
    map.setStyle(BASEMAP_STYLES[basemap]);
  }, [basemap]);

  const applyPreviewLayer = useCallback(() => {
    const map = mapRef.current;
    if (!map || !previewImageUrl || !latestBounds) return;
    const coordinates: [number, number][] = [
      [latestBounds.west, latestBounds.north],
      [latestBounds.east, latestBounds.north],
      [latestBounds.east, latestBounds.south],
      [latestBounds.west, latestBounds.south],
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
  }, [latestBounds, previewImageUrl, removePreviewLayer]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!previewImageUrl || !latestBounds) {
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
  }, [applyPreviewLayer, latestBounds, previewImageUrl, removePreviewLayer]);


  useEffect(() => {
    applyFlyTo();
  }, [applyFlyTo, flyToTarget]);

  const toggleMapInteractions = useCallback((enable: boolean) => {
    const map = mapRef.current;
    if (!map) return;
    const action = enable ? "enable" : "disable";
    map.dragPan[action]();
    map.scrollZoom[action]?.();
    map.doubleClickZoom[action]?.();
  }, []);

  useEffect(() => {
    if (sizeCommand == null) return;
    if (!mapRef.current || !mapContainerRef.current) return;
    const map = mapRef.current;
    const { latitude, longitude } = viewStateRef.current;
    const widthPx = mapContainerRef.current.clientWidth || 256;
    const targetZoom = kmToZoom(sizeCommand, widthPx, latitude);
    map.easeTo({
      center: [longitude, latitude],
      zoom: targetZoom,
      duration: 0,
    });
    setViewState({ latitude, longitude, zoom: targetZoom });
    clearAoi("size preset applied");
    setIsDrawing(false);
    setIsDragging(false);
    toggleMapInteractions(true);
    dragStartRef.current = null;
    if (onSizeCommandHandled) onSizeCommandHandled();
  }, [clearAoi, onSizeCommandHandled, sizeCommand, toggleMapInteractions]);

  const updateRectFromClient = useCallback(
    (clientX: number, clientY: number) => {
      if (!dragStartRef.current || !mapContainerRef.current) return;
      const rect = mapContainerRef.current.getBoundingClientRect();
      const currX = clientX - rect.left;
      const currY = clientY - rect.top;
      const startX = dragStartRef.current.x;
      const startY = dragStartRef.current.y;
      const x = Math.min(startX, currX);
      const y = Math.min(startY, currY);
      const width = Math.abs(currX - startX);
      const height = Math.abs(currY - startY);
      setAoiRect({ x, y, width, height });
    },
    [],
  );

  const finalizeAoi = useCallback(() => {
    setIsDragging(false);
    setIsDrawing(false);
    toggleMapInteractions(true);
    const rect = aoiRectRef.current;
    if (!rect || !mapRef.current) {
      console.warn("[PreviewPane] finalizeAoi missing rect or map");
      dragStartRef.current = null;
      return;
    }
    const MIN_SIZE = 20;
    if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) {
      clearAoi("drawn AOI too small");
      return;
    }
    const map = mapRef.current;
    const topLeft = map.unproject([rect.x, rect.y]);
    const bottomRight = map.unproject([rect.x + rect.width, rect.y + rect.height]);
    const bounds: AoiBounds = {
      west: topLeft.lng,
      north: topLeft.lat,
      east: bottomRight.lng,
      south: bottomRight.lat,
    };
    console.log("[PreviewPane] finalizeAoi computed bounds:", bounds);
    pushBounds(bounds);
    dragStartRef.current = null;
  }, [clearAoi, pushBounds, toggleMapInteractions]);

  const handleOverlayMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isDrawing || e.button !== 0 || !mapContainerRef.current) return;
      e.preventDefault();
      const rect = mapContainerRef.current.getBoundingClientRect();
      const startX = e.clientX - rect.left;
      const startY = e.clientY - rect.top;
      dragStartRef.current = { x: startX, y: startY };
      setIsDragging(true);
      toggleMapInteractions(false);
      setAoiRect({ x: startX, y: startY, width: 0, height: 0 });
      if (onClearPreview) onClearPreview();
    },
    [isDrawing, onClearPreview, toggleMapInteractions],
  );

  const handleOverlayMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isDrawing || !isDragging) return;
      e.preventDefault();
      updateRectFromClient(e.clientX, e.clientY);
    },
    [isDragging, isDrawing, updateRectFromClient],
  );

  const handleOverlayMouseUp = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isDrawing || !isDragging) return;
      e.preventDefault();
      updateRectFromClient(e.clientX, e.clientY);
      finalizeAoi();
    },
    [finalizeAoi, isDragging, isDrawing, updateRectFromClient],
  );

  const handleOverlayMouseLeave = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isDrawing || !isDragging) return;
      e.preventDefault();
      updateRectFromClient(e.clientX, e.clientY);
      finalizeAoi();
    },
    [finalizeAoi, isDragging, isDrawing, updateRectFromClient],
  );

  const drawInitRef = useRef(false);
  useEffect(() => {
    if (!drawInitRef.current) {
      drawInitRef.current = true;
      return;
    }
    if (drawCommand <= 0) return;
    clearAoi("draw command start");
    setIsDrawing(true);
    setIsDragging(false);
    dragStartRef.current = null;
    toggleMapInteractions(false);
  }, [clearAoi, drawCommand, toggleMapInteractions]);

  const clearInitRef = useRef(false);
  useEffect(() => {
    if (!clearInitRef.current) {
      clearInitRef.current = true;
      return;
    }
    clearAoi("external clear command");
    setIsDrawing(false);
    setIsDragging(false);
    dragStartRef.current = null;
    toggleMapInteractions(true);
  }, [clearAoi, clearCommand, toggleMapInteractions]);

  const aoiBorder = useMemo(() => {
    if (!aoiRect) return null;
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

  return (
    <div className="map-wrapper" ref={mapContainerRef}>
      <div className="map-canvas" ref={mapCanvasRef} />
      {aoiBorder}
      <div
        className="draw-overlay"
        onMouseDown={handleOverlayMouseDown}
        onMouseMove={handleOverlayMouseMove}
        onMouseUp={handleOverlayMouseUp}
        onMouseLeave={handleOverlayMouseLeave}
        style={{
          position: "absolute",
          inset: 0,
          cursor: isDrawing ? "crosshair" : "default",
          pointerEvents: isDrawing ? "auto" : "none",
          background: "transparent",
        }}
      />
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
