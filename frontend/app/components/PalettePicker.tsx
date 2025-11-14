"use client";

import type { Palette } from "../api";

type Props = {
  palette: Palette;
  onChange: (next: Palette) => void;
};

const palettes: { value: Palette; label: string }[] = [
  { value: "vivid", label: "Vivid" },
  { value: "warm", label: "Warm" },
  { value: "cool", label: "Cool" },
  { value: "neutral", label: "Neutral" },
  { value: "random", label: "Random" },
];

export default function PalettePicker({ palette, onChange }: Props) {
  return (
    <div className="palette-picker">
      <p>Palette</p>
      <div className="palette-grid">
        {palettes.map((item) => (
          <label key={item.value}>
            <input
              type="radio"
              name="palette"
              value={item.value}
              checked={palette === item.value}
              onChange={() => onChange(item.value)}
            />
            {item.label}
          </label>
        ))}
      </div>
      <style jsx>{`
        .palette-picker {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
        }
        .palette-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0.35rem 0.75rem;
        }
        label {
          display: flex;
          align-items: center;
          gap: 0.35rem;
          font-size: 0.9rem;
        }
      `}</style>
    </div>
  );
}
