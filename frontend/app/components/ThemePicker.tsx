"use client";

import type { Theme } from "../api";

type Props = {
  theme: Theme;
  onChange: (next: Theme) => void;
};

const themes: { value: Theme; label: string }[] = [
  { value: "true", label: "True Color" },
  { value: "false_veg", label: "False Vegetation" },
  { value: "ndvi", label: "NDVI" },
  { value: "pca", label: "PCA (ICA vivid)" },
  { value: "decorr", label: "Decorrelation Stretch" },
  { value: "nmf", label: "NMF-3" },
  { value: "index_triplet", label: "Index Triplets" },
  { value: "geology", label: "Geology" },
];

export default function ThemePicker({ theme, onChange }: Props) {
  return (
    <div className="theme-picker">
      <p>Theme</p>
      <div className="theme-grid">
        {themes.map((item) => (
          <label key={item.value}>
            <input
              type="radio"
              name="theme"
              checked={theme === item.value}
              onChange={() => onChange(item.value)}
            />
            {item.label}
          </label>
        ))}
      </div>
      <style jsx>{`
        .theme-picker {
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
        }
        .theme-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0.4rem 0.75rem;
        }
        label {
          display: flex;
          gap: 0.35rem;
          align-items: center;
          font-size: 0.9rem;
        }
      `}</style>
    </div>
  );
}
