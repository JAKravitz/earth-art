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
  previewBounds?: [number, number, number, number] | null;
  presetBounds?: [number, number, number, number] | null;
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
const AOI_SOURCE_ID = "aoi-outline-source";
const AOI_LAYER_ID = "aoi-outline-layer";

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
  previewBounds,
  presetBounds,
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
  const latestBoundsRef = useRef<AoiBounds | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [aoiRect, setAoiRect] = useState<AoiRect | null>(null);
  const [latestBounds, setLatestBounds] = useState<AoiBounds | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const flyTokenRef = useRef<number | null>(null);
  const prevDrawCommandRef = useRef<number | null>(null);
  const prevPresetBoundsRef = useRef<AoiBounds | null>(null);

  const previewBoundsObj = useMemo(() => {
    if (!previewBounds) return null;
    const [west, south, east, north] = previewBounds;
    return { west, south, east, north };
  }, [previewBounds]);

  const presetBoundsObj = useMemo(() => {
    if (!presetBounds) return null;
    const [west, south, east, north] = presetBounds;
    return { west, south, east, north };
  }, [presetBounds]);

  const activeBounds = useMemo(
    () => previewBoundsObj ?? presetBoundsObj ?? latestBounds,
    [latestBounds, presetBoundsObj, previewBoundsObj],
  );

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
      latestBoundsRef.current = bounds;
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

  const projectBoundsToRect = useCallback(
    (bounds: AoiBounds | null): AoiRect | null => {
      const map = mapRef.current;
      if (!bounds || !map) return null;
      const topLeft = map.project([bounds.west, bounds.north]);
      const bottomRight = map.project([bounds.east, bounds.south]);
      const x = Math.min(topLeft.x, bottomRight.x);
      const y = Math.min(topLeft.y, bottomRight.y);
      const width = Math.abs(bottomRight.x - topLeft.x);
      const height = Math.abs(bottomRight.y - topLeft.y);
      if (width <= 0 || height <= 0) return null;
      return { x, y, width, height };
    },
    [],
  );

  const syncAoiOverlayToBounds = useCallback(() => {
    if (isDrawing || isDragging) return;
    const bounds = activeBounds ?? latestBoundsRef.current;
    if (!bounds) return;
    const rect = projectBoundsToRect(bounds);
    if (!rect) return;
    setAoiRect((prev) => {
      if (prev && prev.x === rect.x && prev.y === rect.y && prev.width === rect.width && prev.height === rect.height) {
        return prev;
      }
      return rect;
    });
  }, [activeBounds, isDragging, isDrawing, projectBoundsToRect]);


  const syncViewFromMap = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const center = map.getCenter();
    const zoom = map.getZoom();
    setViewState({ latitude: center.lat, longitude: center.lng, zoom });
    viewStateRef.current = { latitude: center.lat, longitude: center.lng, zoom };
  }, []);

  const handleMapMove = useCallback(
    (_evt: maplibregl.MapMouseEvent) => {
      // no-op for now to avoid render loops
      const map = mapRef.current;
      if (!map) return;
      const { lat, lng } = map.getCenter();
      const zoom = map.getZoom();
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

  const updateAoiLayer = useCallback(
    (bounds: AoiBounds | null) => {
      const map = mapRef.current;
      if (!map || !bounds) return;
      const poly = {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [bounds.west, bounds.south],
              [bounds.east, bounds.south],
              [bounds.east, bounds.north],
              [bounds.west, bounds.north],
              [bounds.west, bounds.south],
            ],
          ],
        },
        properties: {},
      } as any;
      let src = map.getSource(AOI_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (!src) {
        map.addSource(AOI_SOURCE_ID, { type: "geojson", data: poly });
        map.addLayer({
          id: AOI_LAYER_ID,
          type: "line",
          source: AOI_SOURCE_ID,
          paint: { "line-color": "#ff4d4f", "line-width": 3 },
        });
      } else {
        src.setData(poly);
      }
    },
    [],
  );

  const ensureZoomEnabled = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.dragPan.enable();
    map.scrollZoom.enable();
    map.doubleClickZoom.enable();
    map.touchZoomRotate.enable();
    map.boxZoom.enable();
  }, []);

  const toggleMapInteractions = useCallback((_enable: boolean) => {
    const map = mapRef.current;
    if (!map) return;
    // Always enable interactions; we no longer disable them to avoid blocking pan/zoom
    map.dragPan.enable();
    map.scrollZoom.enable();
    map.doubleClickZoom.enable();
    map.touchZoomRotate.enable();
    map.boxZoom.enable();
  }, []);

  // sync AOI when preset bounds change
  useEffect(() => {
    if (!presetBoundsObj || !mapReady) return;
    const prev = prevPresetBoundsRef.current;
    if (
      prev &&
      prev.west === presetBoundsObj.west &&
      prev.south === presetBoundsObj.south &&
      prev.east === presetBoundsObj.east &&
      prev.north === presetBoundsObj.north
    ) {
      return;
    }
    prevPresetBoundsRef.current = presetBoundsObj;
    setIsDrawing(false);
    setIsDragging(false);
    dragStartRef.current = null;
    toggleMapInteractions(true);
    latestBoundsRef.current = presetBoundsObj;
    setLatestBounds(presetBoundsObj);
    updateAoiLayer(presetBoundsObj);
    const rect = projectBoundsToRect(presetBoundsObj);
    if (rect) {
      setAoiRect(rect);
    }
  }, [mapReady, presetBoundsObj, projectBoundsToRect, updateAoiLayer]);

  useEffect(() => {
    if (!mapCanvasRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapCanvasRef.current,
      style: BASEMAP_STYLES[basemapRef.current],
      center: [DEFAULT_VIEW.longitude, DEFAULT_VIEW.latitude],
      zoom: DEFAULT_VIEW.zoom,
      fadeDuration: 0,
    });
    mapRef.current = map;
    (window as any).__MAP = map;

    map.on("load", () => {
      setMapReady(true);
      if (!map.getSource(AOI_SOURCE_ID)) {
        map.addSource(AOI_SOURCE_ID, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }
      if (!map.getLayer(AOI_LAYER_ID)) {
        map.addLayer({
          id: AOI_LAYER_ID,
          type: "line",
          source: AOI_SOURCE_ID,
          paint: { "line-color": "#ff4d4f", "line-width": 3 },
        });
      }
      map.dragPan.enable();
      map.scrollZoom.enable();
      map.doubleClickZoom.enable();
      map.touchZoomRotate.enable();
      map.boxZoom.enable();
      syncViewFromMap();
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [syncViewFromMap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (basemapRef.current === basemap) return;
    basemapRef.current = basemap;
    map.setStyle(BASEMAP_STYLES[basemap]);
    const reenable = () => ensureZoomEnabled();
    map.once("styledata", reenable);
  }, [basemap, ensureZoomEnabled]);

  const applyPreviewLayer = useCallback(() => {
    const map = mapRef.current;
    if (!map || !previewImageUrl || !activeBounds) return;
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
    updateAoiLayer(activeBounds ?? latestBoundsRef.current);
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
  }, [activeBounds, applyPreviewLayer, previewImageUrl, removePreviewLayer, updateAoiLayer]);

  useEffect(() => {
    syncAoiOverlayToBounds();
  }, [activeBounds, mapReady, syncAoiOverlayToBounds]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handler = () => syncAoiOverlayToBounds();
    map.on("move", handler);
    map.on("resize", handler);
    return () => {
      map.off("move", handler);
      map.off("resize", handler);
    };
  }, [syncAoiOverlayToBounds]);


  useEffect(() => {
    if (!mapRef.current || !flyToTarget) return;
    if (flyTokenRef.current === flyToTarget.token) return;
    flyTokenRef.current = flyToTarget.token;
    const map = mapRef.current;
    const zoom = map.getZoom();
    setViewState({ latitude: flyToTarget.lat, longitude: flyToTarget.lon, zoom });
    ensureZoomEnabled();
    map.easeTo({
      center: [flyToTarget.lon, flyToTarget.lat],
      zoom,
      duration: 0,
    });
  }, [ensureZoomEnabled, flyToTarget]);

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
    const projectedRect = projectBoundsToRect(bounds);
    if (projectedRect) {
      setAoiRect(projectedRect);
    }
    dragStartRef.current = null;
  }, [clearAoi, projectBoundsToRect, pushBounds, toggleMapInteractions]);

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

  useEffect(() => {
    if (drawCommand == null) return;
    if (prevDrawCommandRef.current === drawCommand) return;
    prevDrawCommandRef.current = drawCommand;
    if (drawCommand <= 0) return;
    clearAoi("draw command start");
    setIsDrawing(true);
    setIsDragging(false);
    dragStartRef.current = null;
    toggleMapInteractions(false);
  }, [clearAoi, drawCommand, toggleMapInteractions]);

  const prevClearCommandRef = useRef<number | null>(null);
  useEffect(() => {
    if (clearCommand == null) return;
    if (prevClearCommandRef.current === clearCommand) return;
    prevClearCommandRef.current = clearCommand;
    clearAoi("external clear command");
    setIsDrawing(false);
    setIsDragging(false);
    dragStartRef.current = null;
    toggleMapInteractions(true);
  }, [clearCommand, clearAoi, toggleMapInteractions]);

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
        style={{
          position: "absolute",
          inset: 0,
          cursor: "default",
          pointerEvents: "none",
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
