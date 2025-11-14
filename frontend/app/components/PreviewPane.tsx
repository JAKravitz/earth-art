"use client";

import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import maplibregl, { LngLatBoundsLike, Map } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection } from "geojson";

interface Props {
  center: { lat: number; lon: number };
  bbox?: [number, number, number, number];
  previewBase64?: string;
  loading: boolean;
  sceneInfo?: Record<string, unknown>;
  showSelection: boolean;
  onBoundsChange?: (bbox: [number, number, number, number]) => void;
}

const MAP_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const PREVIEW_SOURCE_ID = "earth-art-image";
const PREVIEW_LAYER_ID = `${PREVIEW_SOURCE_ID}-layer`;
const SELECTION_SOURCE_ID = "selection-bounds";
const SELECTION_LAYER_ID = `${SELECTION_SOURCE_ID}-line`;

function base64PngToBlobUrl(b64: string): string {
  const prefix = "data:image";
  const clean = b64.startsWith(prefix) ? b64.split(",")[1] : b64;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: "image/png" });
  return URL.createObjectURL(blob);
}

function coordsFromBbox(bbox: [number, number, number, number]): [number, number][] {
  const [minX, minY, maxX, maxY] = bbox;
  return [
    [minX, maxY],
    [maxX, maxY],
    [maxX, minY],
    [minX, minY],
  ];
}

function hashBase64(b64: string): string {
  const clean = b64.startsWith("data:image") ? b64.split(",")[1] : b64;
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < clean.length; i += 1) {
    hash ^= clean.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

async function onStyleReady(map: maplibregl.Map): Promise<void> {
  if (map.isStyleLoaded()) return;
  await new Promise<void>((resolve) => {
    map.once("idle", () => resolve());
  });
}

function bboxPolygon(bounds: [number, number, number, number]): FeatureCollection {
  const [minLon, minLat, maxLon, maxLat] = bounds;
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [minLon, minLat],
              [minLon, maxLat],
              [maxLon, maxLat],
              [maxLon, minLat],
              [minLon, minLat],
            ],
          ],
        },
        properties: {},
      },
    ],
  } satisfies FeatureCollection;
}

export default function PreviewPane({
  center,
  bbox,
  previewBase64,
  loading,
  sceneInfo,
  showSelection,
  onBoundsChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const bboxRef = useRef<typeof bbox>();
  const boundsCallbackRef = useRef<typeof onBoundsChange>();
  const lastPreviewRef = useRef<{ url: string; coords: [number, number][]; bbox: [number, number, number, number] } | null>(
    null,
  );
  const lastObjectUrlRef = useRef<string | null>(null);
  const lastHashRef = useRef<string | null>(null);
  const lastCoordsRef = useRef<string | null>(null);
  const restoringRef = useRef(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    bboxRef.current = bbox;
  }, [bbox]);

  useEffect(() => {
    boundsCallbackRef.current = onBoundsChange;
  }, [onBoundsChange]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [center.lon, center.lat],
      zoom: 8,
      fadeDuration: 0,
    });
    mapRef.current = map;

    const handleLoad = () => {
      if (bboxRef.current) fitBounds(map, bboxRef.current);
      if (boundsCallbackRef.current) {
        const bounds = map.getBounds();
        boundsCallbackRef.current([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]);
      }
    };

    const handleStyleData = () => {
      if (lastPreviewRef.current) {
        restorePreviewOverlay(map, lastPreviewRef.current, restoringRef).catch((error) =>
          console.warn("[overlay] restore failed", error),
        );
      }
    };

    const handleMoveEnd = () => {
      if (!boundsCallbackRef.current) return;
      const bounds = map.getBounds();
      boundsCallbackRef.current([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]);
    };

    map.on("load", handleLoad);
    map.on("styledata", handleStyleData);
    map.on("moveend", handleMoveEnd);

    return () => {
      map.off("load", handleLoad);
      map.off("styledata", handleStyleData);
      map.off("moveend", handleMoveEnd);
      map.remove();
      mapRef.current = null;
    };
  }, [center.lat, center.lon]);

  useEffect(() => {
    const map = mapRef.current;
    const container = containerRef.current;
    if (!map || !container) return;
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(
    () => () => {
      if (lastObjectUrlRef.current) URL.revokeObjectURL(lastObjectUrlRef.current);
    },
    [],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bbox) return;
    (async () => {
      await upsertSelectionLayer(map, bbox, showSelection);
      fitBounds(map, bbox);
    })();
  }, [bbox, showSelection]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      if (!previewBase64 || !bbox) {
        removePreviewImage(map);
        if (lastObjectUrlRef.current) {
          URL.revokeObjectURL(lastObjectUrlRef.current);
          lastObjectUrlRef.current = null;
        }
        lastPreviewRef.current = null;
        lastHashRef.current = null;
        lastCoordsRef.current = null;
        return;
      }
      const coords = coordsFromBbox(bbox);
      upsertImageOverlay(
        map,
        previewBase64,
        bbox,
        coords,
        lastPreviewRef,
        lastObjectUrlRef,
        lastHashRef,
        lastCoordsRef,
      );
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [previewBase64, bbox]);

  return (
    <div className="map-wrapper">
      <div ref={containerRef} className="map-canvas" />
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

async function upsertImageOverlay(
  map: Map,
  base64: string,
  bbox: [number, number, number, number],
  coords: [number, number][],
  lastPreviewRef: MutableRefObject<{
    url: string;
    coords: [number, number][];
    bbox: [number, number, number, number];
  } | null>,
  lastObjectUrlRef: MutableRefObject<string | null>,
  lastHashRef: MutableRefObject<string | null>,
  lastCoordsRef: MutableRefObject<string | null>,
) {
  await onStyleReady(map);
  const hash = hashBase64(base64);
  const coordsKey = JSON.stringify(coords);
  if (hash === lastHashRef.current && coordsKey === lastCoordsRef.current) {
    console.debug("[overlay] unchanged preview");
    fitBounds(map, bbox);
    return;
  }
  const objectUrl = base64PngToBlobUrl(base64);
  if (lastObjectUrlRef.current && lastObjectUrlRef.current !== objectUrl) {
    URL.revokeObjectURL(lastObjectUrlRef.current);
  }
  lastObjectUrlRef.current = objectUrl;
  console.debug("[overlay] bbox", bbox, "src?", !!map.getSource(PREVIEW_SOURCE_ID), "lyr?", !!map.getLayer(PREVIEW_LAYER_ID));
  try {
    const existing = map.getSource(PREVIEW_SOURCE_ID) as maplibregl.ImageSource | undefined;
    if (existing) {
      existing.setCoordinates(coords);
      await existing.updateImage({ url: objectUrl });
    } else {
      map.addSource(PREVIEW_SOURCE_ID, { type: "image", url: objectUrl, coordinates: coords });
      if (!map.getLayer(PREVIEW_LAYER_ID)) {
        map.addLayer({
          id: PREVIEW_LAYER_ID,
          type: "raster",
          source: PREVIEW_SOURCE_ID,
          paint: { "raster-opacity": 1, "raster-resampling": "linear" },
        });
      }
    }
  } catch (error) {
    console.warn("[overlay] re-add after failure", error);
    removePreviewImage(map);
    map.addSource(PREVIEW_SOURCE_ID, { type: "image", url: objectUrl, coordinates: coords });
    map.addLayer({
      id: PREVIEW_LAYER_ID,
      type: "raster",
      source: PREVIEW_SOURCE_ID,
      paint: { "raster-opacity": 1, "raster-resampling": "linear" },
    });
  }
  try {
    map.moveLayer(PREVIEW_LAYER_ID);
  } catch {
    // ignore
  }
  lastHashRef.current = hash;
  lastCoordsRef.current = coordsKey;
  lastPreviewRef.current = { url: objectUrl, coords, bbox };
  fitBounds(map, bbox);
}

async function restorePreviewOverlay(
  map: Map,
  preview: { url: string; coords: [number, number][] } | null,
  restoringRef: MutableRefObject<boolean>,
) {
  if (!preview || restoringRef.current) return;
  const hasSource = !!map.getSource(PREVIEW_SOURCE_ID);
  const hasLayer = !!map.getLayer(PREVIEW_LAYER_ID);
  if (hasSource && hasLayer) return;
  restoringRef.current = true;
  try {
    await onStyleReady(map);
    const { url, coords } = preview;
    if (!hasSource) {
      map.addSource(PREVIEW_SOURCE_ID, { type: "image", url, coordinates: coords });
    }
    if (!hasLayer) {
      map.addLayer({
        id: PREVIEW_LAYER_ID,
        type: "raster",
        source: PREVIEW_SOURCE_ID,
        paint: { "raster-opacity": 1, "raster-resampling": "linear" },
      });
    }
    try {
      map.moveLayer(PREVIEW_LAYER_ID);
    } catch {
      // ignore
    }
  } catch (error) {
    console.warn("[overlay] restore error", error);
  } finally {
    restoringRef.current = false;
  }
}

function fitBounds(map: Map, bbox: [number, number, number, number]) {
  map.fitBounds(
    [
      [bbox[0], bbox[1]],
      [bbox[2], bbox[3]],
    ] as LngLatBoundsLike,
    { padding: 24, animate: false },
  );
}

async function upsertSelectionLayer(map: Map, bbox: [number, number, number, number], visible: boolean) {
  await onStyleReady(map);
  const geojson = bboxPolygon(bbox);
  if (map.getSource(SELECTION_SOURCE_ID)) {
    const source = map.getSource(SELECTION_SOURCE_ID) as maplibregl.GeoJSONSource;
    source.setData(geojson);
  } else {
    map.addSource(SELECTION_SOURCE_ID, { type: "geojson", data: geojson });
    map.addLayer({
      id: SELECTION_LAYER_ID,
      type: "line",
      source: SELECTION_SOURCE_ID,
      paint: { "line-color": "#ef4444", "line-width": 2 },
    });
  }
  map.setLayoutProperty(SELECTION_LAYER_ID, "visibility", visible ? "visible" : "none");
}

function removePreviewImage(map: Map) {
  if (map.getLayer(PREVIEW_LAYER_ID)) {
    map.removeLayer(PREVIEW_LAYER_ID);
  }
  if (map.getSource(PREVIEW_SOURCE_ID)) {
    map.removeSource(PREVIEW_SOURCE_ID);
  }
}
