"use client";

import { Suspense, useEffect, useMemo, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PreviewPane from "../../components/PreviewPane";
import SearchBar from "../../components/SearchBar";
import { useEarthsySession } from "../../context/EarthsySession";
import {
  DEFAULT_ROAD_SIZE_ID,
  ROAD_CITY_PRESETS,
  ROAD_SIZE_PRESETS,
  RoadCityId,
  RoadSizeId,
  getRoadCityById,
  getRoadSizeById,
} from "../presets";

const DEFAULT_CENTER = { lat: 32.7157, lon: -117.1611 };

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
    setCenter: setSessionCenter,
    setPreset,
    setAoi,
    setPreviews,
    setSelectedFilterId,
  } = useEarthsySession();
  const [selectedCityId, setSelectedCityId] = useState<RoadCityId | null>(null);
  const [selectedSizeId, setSelectedSizeId] = useState<RoadSizeId>(DEFAULT_ROAD_SIZE_ID);
  const [center, setCenter] = useState(DEFAULT_CENTER);
  const [aoiBounds, setAoiBounds] = useState<[number, number, number, number] | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [previewBounds, setPreviewBounds] = useState<[number, number, number, number] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flyTarget, setFlyTarget] = useState<{ lat: number; lon: number; token: number } | null>(null);
  const [initializedFromUrl, setInitializedFromUrl] = useState(false);
  const activeSizeSpec = useMemo(() => getRoadSizeById(selectedSizeId), [selectedSizeId]);
  const activePresetId = useMemo(() => {
    if (!selectedCityId) return selectedSizeId;
    return `${selectedCityId}-${selectedSizeId}`;
  }, [selectedCityId, selectedSizeId]);
  const handleClearPreview = useCallback(() => setPreviewImageUrl(null), []);

  useEffect(() => {
    if (initializedFromUrl) return;
    const lat = parseFloat(search.get("lat") || `${DEFAULT_CENTER.lat}`);
    const lon = parseFloat(search.get("lon") || `${DEFAULT_CENTER.lon}`);
    const cityParam = (search.get("city") as RoadCityId | null) || null;
    const sizeParam = (search.get("size") as RoadSizeId | null) || null;
    const sizeId = sizeParam && getRoadSizeById(sizeParam) ? sizeParam : DEFAULT_ROAD_SIZE_ID;
    const centerVal = { lat, lon };
    const cityPreset = cityParam ? getRoadCityById(cityParam) : null;
    if (cityPreset) {
      setSelectedCityId(cityPreset.id);
      setSelectedSizeId(DEFAULT_ROAD_SIZE_ID);
      setCenter(cityPreset.center);
      setFlyTarget({ lat: cityPreset.center.lat, lon: cityPreset.center.lon, token: Date.now() });
      const spec = getRoadSizeById(DEFAULT_ROAD_SIZE_ID);
      if (spec) {
        const bbox = bboxAroundCenterKm(cityPreset.center, spec.km, spec.km);
        setAoiBounds(bbox);
      }
    } else {
      setSelectedCityId(null);
      setSelectedSizeId(sizeId);
      setCenter(centerVal);
      setFlyTarget({ lat, lon, token: Date.now() });
      const spec = getRoadSizeById(sizeId);
      if (spec) {
        const bbox = bboxAroundCenterKm(centerVal, spec.km, spec.km);
        setAoiBounds(bbox);
      }
    }
    setInitializedFromUrl(true);
  }, [initializedFromUrl, search]);

  const handleRender = () => {
    if (!aoiBounds) return;
    const sessionCenter = centerFromBounds(aoiBounds);
    setLoading(true);
    setError(null);
    setPreviewImageUrl(null);
    setPreviewBounds(null);
    setProduct("roads");
    setSessionCenter(sessionCenter);
    setPreset(null);
    setAoi(null, aoiBounds);
    setPreviews({});
    setSelectedFilterId(null);
    router.push("/roads/editor");
    setLoading(false);
  };

  return (
    <div className="playground">
      <aside className="sidebar">
        <p className="eyebrow">Road Networks</p>
        <h1>Choose your canvas</h1>
        <div className="search">
          <SearchBar
            onSelect={(lat, lon) => {
              const next = { lat, lon };
              setCenter(next);
              setFlyTarget({ lat, lon, token: Date.now() });
              setSelectedCityId(null);
              const spec = getRoadSizeById(selectedSizeId);
              if (spec) {
                setAoiBounds(bboxAroundCenterKm(next, spec.km, spec.km));
              }
            }}
          />
        </div>
        <div className="section">
          <p className="section-title">City presets</p>
          <div className="preset-list">
            {ROAD_CITY_PRESETS.map((city) => (
            <button
              key={city.id}
              className={`preset-card ${selectedCityId === city.id ? "active" : ""}`}
              onClick={() => {
                setSelectedCityId(city.id);
                setSelectedSizeId(DEFAULT_ROAD_SIZE_ID);
                setCenter(city.center);
                setFlyTarget({ lat: city.center.lat, lon: city.center.lon, token: Date.now() });
                const spec = getRoadSizeById(DEFAULT_ROAD_SIZE_ID);
                if (!spec) return;
                const bbox = bboxAroundCenterKm(city.center, spec.km, spec.km);
                setAoiBounds(bbox);
                setPreviewImageUrl(null);
                setPreviewBounds(null);
              }}
            >
              <div className="outline" />
              <div>
                <div className="title">{city.name}</div>
                <div className="desc">{city.country}</div>
              </div>
            </button>
            ))}
          </div>
        </div>
        <div className="section">
          <p className="section-title">AOI size</p>
          <div className="preset-list">
            {ROAD_SIZE_PRESETS.map((size) => (
              <button
                key={size.id}
                className={`preset-card ${selectedSizeId === size.id ? "active" : ""}`}
                onClick={() => {
                  setSelectedSizeId(size.id);
                  const spec = getRoadSizeById(size.id);
                  if (!spec) return;
                  const bbox = bboxAroundCenterKm(center, spec.km, spec.km);
                  setAoiBounds(bbox);
                  setPreviewImageUrl(null);
                  setPreviewBounds(null);
                }}
              >
                <div className="outline" />
                <div>
                  <div className="title">{size.label}</div>
                  <div className="desc">{size.description}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
        <p className="hint">Move the map to frame your artwork. We keep a wider view so prints look smooth.</p>
        {error ? <p className="error">{error}</p> : null}
        <button className="primary" disabled={!aoiBounds || loading} onClick={handleRender}>
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
          activePresetId={activePresetId}
          presetAspect={activeSizeSpec ? 1 : null}
          loading={loading}
          sceneInfo={undefined}
          showSelection={true}
          basemap="imagery"
          onMapCenterChange={(c) => {
            if (!selectedCityId) setCenter(c);
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
          aspect-ratio: 1;
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

export default function RoadNetworksPlayground() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading playground…</div>}>
      <PlaygroundInner />
    </Suspense>
  );
}
