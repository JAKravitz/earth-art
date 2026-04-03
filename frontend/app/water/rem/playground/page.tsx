"use client";

import type { FeatureCollection } from "geojson";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import PreviewPane from "../../../components/PreviewPane";
import SearchBar from "../../../components/SearchBar";
import { useEarthsySession } from "../../../context/EarthsySession";
import {
  DEFAULT_REM_SIZE_ID,
  REM_RIVER_PRESETS,
  REM_SIZE_PRESETS,
  REMRiverId,
  REMSizeId,
  getREMRiverById,
  getREMSizeById,
} from "../presets";

const DEFAULT_CENTER = { lat: 44.8, lon: -123.0 };

/** Continental USA bounds for map maxBounds. */
const USA_BOUNDS: [number, number, number, number] = [-125, 24, -66, 50];

function centerFromBounds(bbox: [number, number, number, number]) {
  const [west, south, east, north] = bbox;
  return { lat: (south + north) / 2, lon: (west + east) / 2 };
}

function bboxAroundCenterKm(
  center: { lat: number; lon: number },
  sizeKm: number,
): [number, number, number, number] {
  const earthRadiusKm = 6371;
  const latRad = (center.lat * Math.PI) / 180;
  const dLat = (sizeKm / earthRadiusKm) * (180 / Math.PI);
  const dLon = ((sizeKm / earthRadiusKm) * (180 / Math.PI)) / Math.cos(latRad || 1e-6);
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
  const [selectedRiverId, setSelectedRiverId] = useState<REMRiverId | null>(null);
  const [selectedSizeId, setSelectedSizeId] = useState<REMSizeId>(DEFAULT_REM_SIZE_ID);
  const [center, setCenter] = useState(DEFAULT_CENTER);
  const [aoiBounds, setAoiBounds] = useState<[number, number, number, number] | null>(null);
  const [flyTarget, setFlyTarget] = useState<{ lat: number; lon: number; token: number } | null>(null);
  const [initializedFromUrl, setInitializedFromUrl] = useState(false);
  const [mapBounds, setMapBounds] = useState<[number, number, number, number] | null>(null);
  const [noCoverageData, setNoCoverageData] = useState<FeatureCollection | null>(null);

  const activeSizeSpec = useMemo(() => getREMSizeById(selectedSizeId), [selectedSizeId]);
  const activePresetId = useMemo(() => {
    if (!selectedRiverId) return selectedSizeId;
    return `${selectedRiverId}-${selectedSizeId}`;
  }, [selectedRiverId, selectedSizeId]);

  useEffect(() => {
    if (initializedFromUrl) return;
    const lat = parseFloat(search.get("lat") || `${DEFAULT_CENTER.lat}`);
    const lon = parseFloat(search.get("lon") || `${DEFAULT_CENTER.lon}`);
    const riverParam = (search.get("river") as REMRiverId | null) || null;
    const sizeParam = (search.get("size") as REMSizeId | null) || null;
    const sizeId =
      sizeParam && getREMSizeById(sizeParam) ? sizeParam : DEFAULT_REM_SIZE_ID;
    const centerVal = { lat, lon };
    const riverPreset = riverParam ? getREMRiverById(riverParam) : null;
    if (riverPreset) {
      setSelectedRiverId(riverPreset.id);
      setCenter(riverPreset.center);
      setFlyTarget({ lat: riverPreset.center.lat, lon: riverPreset.center.lon, token: Date.now() });
      setAoiBounds(bboxAroundCenterKm(riverPreset.center, riverPreset.sizeKm));
    } else {
      setSelectedRiverId(null);
      setCenter(centerVal);
      setFlyTarget({ lat, lon, token: Date.now() });
      // Leave aoiBounds null so map starts in free zoom/pan mode (like spectral-earth / roads).
      setAoiBounds(null);
    }
    setSelectedSizeId(sizeId);
    setInitializedFromUrl(true);
  }, [initializedFromUrl, search]);

  const handleRender = () => {
    if (!aoiBounds) return;
    const sessionCenter = centerFromBounds(aoiBounds);
    setProduct("rem");
    setSessionCenter(sessionCenter);
    setPreset(null);
    setAoi(null, aoiBounds);
    setPreviews({});
    setSelectedFilterId(null);
    router.push("/water/rem/editor");
  };

  // Load static rough no-coverage polygons once (no 3DEP API)
  useEffect(() => {
    let cancelled = false;
    fetch("/rem-no-coverage-approx.json")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Failed to load"))))
      .then((fc: FeatureCollection) => {
        if (!cancelled) setNoCoverageData(fc);
      })
      .catch(() => {
        if (!cancelled) setNoCoverageData(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleBoundsChange = useCallback((bbox: [number, number, number, number]) => {
    setMapBounds(bbox);
  }, []);

  return (
    <div className="playground">
      <aside className="sidebar">
        <p className="eyebrow">River REM</p>
        <h1>Choose your river</h1>
        <Link href="/water" className="back-link">
          Back to Water
        </Link>
        <div className="search">
          <SearchBar
            onSelect={(lat, lon) => {
              const next = { lat, lon };
              setCenter(next);
              setFlyTarget({ lat, lon, token: Date.now() });
              setSelectedRiverId(null);
              const spec = getREMSizeById(selectedSizeId);
              if (spec) setAoiBounds(bboxAroundCenterKm(next, spec.km));
            }}
          />
        </div>
        <div className="section">
          <p className="section-title">Featured rivers</p>
          <div className="preset-list">
            {REM_RIVER_PRESETS.map((river) => (
              <button
                key={river.id}
                type="button"
                className={`preset-card ${selectedRiverId === river.id ? "active" : ""}`}
                onClick={() => {
                  setSelectedRiverId(river.id);
                  setCenter(river.center);
                  setFlyTarget({
                    lat: river.center.lat,
                    lon: river.center.lon,
                    token: Date.now(),
                  });
                  setAoiBounds(bboxAroundCenterKm(river.center, river.sizeKm));
                }}
              >
                <div className="outline" />
                <div>
                  <div className="title">{river.name}</div>
                  <div className="desc">{river.description}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
        <div className="section">
          <p className="section-title">AOI size</p>
          <div className="preset-list">
            {REM_SIZE_PRESETS.map((size) => (
              <button
                key={size.id}
                type="button"
                className={`preset-card ${selectedSizeId === size.id ? "active" : ""}`}
                onClick={() => {
                  setSelectedSizeId(size.id);
                  const spec = getREMSizeById(size.id);
                  if (!spec) return;
                  setAoiBounds(bboxAroundCenterKm(center, spec.km));
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
        <p className="hint">
          This product uses <strong>high‑res (1 m) lidar DEMs only</strong>. Map is limited to the USA. <strong>Red</strong> = no 1 m coverage (avoid for REM). Pick an area outside the red. <a href="https://dancoecarto.com/downloading-and-preparing-lidar-dems-for-rem-processing" target="_blank" rel="noopener noreferrer">Dan Coe tutorial</a>.
        </p>
        {aoiBounds ? (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setAoiBounds(null);
              setSelectedRiverId(null);
            }}
          >
            Clear area
          </button>
        ) : null}
        <button
          type="button"
          className="primary"
          disabled={!aoiBounds}
          onClick={handleRender}
        >
          Create REM
        </button>
      </aside>
      <div className="map-area">
        <PreviewPane
          selectedSizeKm={activeSizeSpec?.km ?? 35}
          sizeCommand={null}
          flyToTarget={flyTarget}
          previewImageUrl={null}
          previewBounds={null}
          presetBounds={aoiBounds}
          activePresetId={activePresetId}
          presetAspect={1}
          loading={false}
          sceneInfo={undefined}
          showSelection={true}
          basemap="imagery"
          onMapCenterChange={(c) => {
            if (!selectedRiverId) setCenter(c);
          }}
          onBoundsChange={handleBoundsChange}
          onFlyComplete={() => setFlyTarget(null)}
          onAoiBoundsChange={setAoiBounds}
          onClearPreview={() => {}}
          onSizeCommandHandled={() => null}
          noCoverageGeoJson={noCoverageData}
          maxBounds={USA_BOUNDS}
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
          cursor: pointer;
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
        .checkbox-row {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #e5e7eb;
          font-size: 0.9rem;
          cursor: pointer;
        }
        .checkbox-row input {
          accent-color: #2563eb;
        }
        .hint {
          color: #94a3b8;
          margin: 0;
          font-size: 0.85rem;
        }
        .hint a {
          color: #94a3b8;
          text-decoration: none;
        }
        .hint a:hover {
          text-decoration: underline;
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
        .secondary {
          padding: 10px 14px;
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 10px;
          background: transparent;
          color: #94a3b8;
          font-weight: 600;
          cursor: pointer;
        }
        .secondary:hover {
          background: rgba(255, 255, 255, 0.06);
          color: #cbd5e1;
        }
        .map-area {
          position: relative;
        }
      `}</style>
    </div>
  );
}

export default function REMPlaygroundPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
      <PlaygroundInner />
    </Suspense>
  );
}
