"use client";

import { useState } from "react";

type Props = {
  onSelect: (lat: number, lon: number, label: string) => void;
};

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
}

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search?format=jsonv2&q=";

export default function SearchBar({ onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${NOMINATIM_URL}${encodeURIComponent(query)}`, {
        headers: { "User-Agent": "earth-art-mvp" },
      });
      if (!res.ok) throw new Error("Failed to geocode");
      const data: NominatimResult[] = await res.json();
      setResults(data.slice(0, 5));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="search-bar">
      <form onSubmit={search}>
        <input
          type="text"
          placeholder="Search for a place"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" disabled={loading}>
          {loading ? "Searching…" : "Search"}
        </button>
      </form>
      {error && <p className="hint">{error}</p>}
      <ul>
        {results.map((result) => (
          <li
            key={result.display_name}
            onClick={() => {
              onSelect(parseFloat(result.lat), parseFloat(result.lon), result.display_name);
              setResults([]);
            }}
          >
            {result.display_name}
          </li>
        ))}
      </ul>
      <style jsx>{`
        .search-bar input {
          width: 100%;
          padding: 0.5rem;
          border-radius: 6px;
          border: 1px solid #333;
          margin-bottom: 0.5rem;
        }
        .search-bar button {
          width: 100%;
          padding: 0.5rem;
          background: #2563eb;
          color: #fff;
          border: none;
          border-radius: 6px;
        }
        ul {
          list-style: none;
          padding: 0;
          margin: 0.25rem 0 0;
          max-height: 8rem;
          overflow: auto;
        }
        li {
          padding: 0.4rem;
          border-bottom: 1px solid #1f2933;
          cursor: pointer;
        }
        li:hover {
          background: #1f2933;
        }
        .hint {
          color: #f87171;
          margin: 0;
          font-size: 0.85rem;
        }
      `}</style>
    </div>
  );
}
