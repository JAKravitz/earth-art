"use client";

import type { OverlayOptions } from "../api";

type Props = {
  overlays: OverlayOptions;
  onChange: (overlays: OverlayOptions) => void;
};

export default function OverlayToggles({ overlays, onChange }: Props) {
  const handle = (key: keyof OverlayOptions) => (event: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...overlays, [key]: event.target.checked });
  };

  return (
    <div>
      <p>Vector overlays</p>
      <label>
        <input type="checkbox" checked={overlays.roads} onChange={handle("roads")} /> Roads
      </label>
      <label>
        <input type="checkbox" checked={overlays.buildings} onChange={handle("buildings")} /> Buildings
      </label>
    </div>
  );
}
