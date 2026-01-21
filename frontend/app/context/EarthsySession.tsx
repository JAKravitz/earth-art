"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Feature, Polygon } from "geojson";
import type { ProductPresetId } from "../config/aoiPresets";
import type { ThemeId } from "../config/themesAndFilters";

type ProductId = "solid-earth" | "water" | "urban" | "roads";

export type PreviewEntry = {
  imageUrl: string;
  filterId: string;
  bbox?: [number, number, number, number];
  scene?: Record<string, unknown>;
};

export type Adjustments = {
  brightness: number;
  contrast: number;
  saturation: number;
};

type SessionState = {
  product: ProductId;
  themeId: ThemeId;
  center: { lat: number; lon: number };
  presetId: ProductPresetId | null;
  aoiFeature: Feature<Polygon> | null;
  aoiBounds: [number, number, number, number] | null;
  previewsByFilterId: Record<string, PreviewEntry>;
  selectedFilterId: string | null;
  adjustments: Adjustments;
  hydrated: boolean;
};

type SessionActions = {
  setProduct: (p: ProductId) => void;
  setTheme: (t: ThemeId) => void;
  setCenter: (c: { lat: number; lon: number }) => void;
  setPreset: (id: ProductPresetId | null) => void;
  setAoi: (feature: Feature<Polygon> | null, bounds: [number, number, number, number] | null) => void;
  setPreviews: (entries: Record<string, PreviewEntry>) => void;
  setSelectedFilterId: (id: string | null) => void;
  setAdjustments: (adj: Partial<Adjustments>) => void;
  reset: () => void;
};

export const DEFAULT_FILTER_ID = "true-color";

const DEFAULT_STATE: SessionState = {
  product: "solid-earth",
  themeId: "earth-science",
  center: { lat: 32.7157, lon: -117.1611 },
  presetId: null,
  aoiFeature: null,
  aoiBounds: null,
  previewsByFilterId: {},
  selectedFilterId: DEFAULT_FILTER_ID,
  adjustments: { brightness: 100, contrast: 100, saturation: 100 },
  hydrated: false,
};

const SessionContext = createContext<(SessionState & SessionActions) | null>(null);

export function EarthsySessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SessionState>(DEFAULT_STATE);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem("earthsy-session") : null;
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SessionState>;
        const { adjustments: _adj, selectedFilterId: _sel, ...rest } = parsed;
        setState({ ...DEFAULT_STATE, ...rest, hydrated: true });
        setHydrated(true);
        return;
      }
    } catch (err) {
      console.warn("Failed to hydrate Earthsy session", err);
    }
    setHydrated(true);
    setState((prev) => ({ ...prev, hydrated: true }));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      const { hydrated: _hydrated, adjustments: _adj, selectedFilterId: _sel, ...persistable } = state;
      window.localStorage.setItem("earthsy-session", JSON.stringify(persistable));
    } catch (err) {
      console.warn("Failed to persist Earthsy session", err);
    }
  }, [state, hydrated]);

  const api = useMemo<SessionState & SessionActions>(
    () => ({
      ...state,
      hydrated,
      setProduct: (p) => setState((prev) => ({ ...prev, product: p })),
      setTheme: (t) => setState((prev) => ({ ...prev, themeId: t })),
      setCenter: (c) => setState((prev) => ({ ...prev, center: c })),
      setPreset: (id) => setState((prev) => ({ ...prev, presetId: id })),
      setAoi: (feature, bounds) => setState((prev) => ({ ...prev, aoiFeature: feature, aoiBounds: bounds })),
      setPreviews: (entries) =>
        setState((prev) => ({
          ...prev,
          previewsByFilterId: entries,
          selectedFilterId: entries[DEFAULT_FILTER_ID]
            ? DEFAULT_FILTER_ID
            : Object.keys(entries)[0] ?? prev.selectedFilterId,
        })),
      setSelectedFilterId: (id) => setState((prev) => ({ ...prev, selectedFilterId: id })),
      setAdjustments: (adj) => setState((prev) => ({ ...prev, adjustments: { ...prev.adjustments, ...adj } })),
      reset: () => setState(DEFAULT_STATE),
    }),
    [state],
  );

  return <SessionContext.Provider value={api}>{children}</SessionContext.Provider>;
}

export function useEarthsySession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useEarthsySession must be used within EarthsySessionProvider");
  return ctx;
}
