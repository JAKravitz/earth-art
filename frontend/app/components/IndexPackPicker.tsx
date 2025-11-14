"use client";

import type { IndexPack } from "../api";

type Props = {
  value: IndexPack;
  onChange: (next: IndexPack) => void;
};

const packs: { value: IndexPack; label: string; hint: string }[] = [
  { value: "veg", label: "Vegetation", hint: "NDVI + GCI + Burn" },
  { value: "aqua", label: "Aqua", hint: "Water / Coastal" },
  { value: "urban", label: "Urban", hint: "Built-up / soil" },
];

export default function IndexPackPicker({ value, onChange }: Props) {
  return (
    <div className="index-pack">
      <p>Index Triplet Pack</p>
      <select value={value} onChange={(e) => onChange(e.target.value as IndexPack)}>
        {packs.map((pack) => (
          <option key={pack.value} value={pack.value}>
            {pack.label} — {pack.hint}
          </option>
        ))}
      </select>
      <style jsx>{`
        .index-pack {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
        }
        select {
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.15);
          background: rgba(15, 23, 42, 0.75);
          color: #e2e8f0;
          padding: 0.45rem 0.5rem;
        }
      `}</style>
    </div>
  );
}
