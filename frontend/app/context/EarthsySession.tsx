"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { Feature, Polygon } from "geojson";
import type { ProductPresetId } from "../config/aoiPresets";
import type { ThemeId } from "../config/themesAndFilters";

type ProductId = "solid-earth" | "water" | "urban";

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

const DEFAULT_STATE: SessionState = {
  product: "solid-earth",
  themeId: "earth-science",
  center: { lat: 32.7157, lon: -117.1611 },
  presetId: null,
  aoiFeature: null,
  aoiBounds: null,
  previewsByFilterId: {},
  selectedFilterId: null,
  adjustments: { brightness: 100, contrast: 100, saturation: 100 },
};

const SessionContext = createContext<(SessionState & SessionActions) | null>(null);

export function EarthsySessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SessionState>(DEFAULT_STATE);

  const api = useMemo<SessionState & SessionActions>(
    () => ({
      ...state,
      setProduct: (p) => setState((prev) => ({ ...prev, product: p })),
      setTheme: (t) => setState((prev) => ({ ...prev, themeId: t })),
      setCenter: (c) => setState((prev) => ({ ...prev, center: c })),
      setPreset: (id) => setState((prev) => ({ ...prev, presetId: id })),
      setAoi: (feature, bounds) => setState((prev) => ({ ...prev, aoiFeature: feature, aoiBounds: bounds })),
      setPreviews: (entries) =>
        setState((prev) => ({
          ...prev,
          previewsByFilterId: entries,
          selectedFilterId: Object.keys(entries)[0] ?? prev.selectedFilterId,
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
