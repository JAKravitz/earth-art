"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { SOLID_EARTH_LOCATIONS } from "./locations";
import SearchBar from "../components/SearchBar";

export default function SolidEarthLanding() {
  const router = useRouter();
  const randomLocation = () => {
    const idx = Math.floor(Math.random() * SOLID_EARTH_LOCATIONS.length);
    const loc = SOLID_EARTH_LOCATIONS[idx];
    router.push(`/solid-earth/playground?lat=${loc.center.lat}&lon=${loc.center.lon}&preset=${loc.presetId ?? "square"}`);
  };

  return (
    <div className="solid-landing">
      <div className="header">
        <h1>Solid Earth</h1>
        <p className="lede">Choose a landscape to begin, or search for your own.</p>
      </div>
      <div className="search">
        <SearchBar
          onSelect={(lat, lon) => {
            router.push(`/solid-earth/playground?lat=${lat}&lon=${lon}&preset=square`);
          }}
        />
      </div>
      <div className="locations">
        {SOLID_EARTH_LOCATIONS.map((loc) => (
          <Link
            key={loc.id}
            href={`/solid-earth/playground?lat=${loc.center.lat}&lon=${loc.center.lon}&preset=${loc.presetId ?? "square"}`}
            className="loc-card"
          >
            <div className="thumb">
              <img src={loc.thumbnail} alt={loc.name} />
            </div>
            <div className="copy">
              <h3>{loc.name}</h3>
              <p>{loc.description}</p>
            </div>
          </Link>
        ))}
      </div>
      <div className="actions">
        <button className="primary" onClick={randomLocation}>
          I’m feeling lucky
        </button>
        <Link className="ghost" href="/solid-earth/playground">
          Open playground
        </Link>
      </div>
      <style jsx>{`
        .solid-landing {
          padding: 40px 32px 48px;
          max-width: 1400px;
          margin: 0 auto;
          color: #e8ecf7;
        }
        .search {
          max-width: 420px;
          margin: 10px 0 4px;
        }
        .lede {
          color: #aebad5;
          font-size: 1.1rem;
        }
        .locations {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
          gap: 22px;
          margin-top: 22px;
        }
        .loc-card {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 14px;
          overflow: hidden;
          text-decoration: none;
          color: inherit;
          display: flex;
          flex-direction: column;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .loc-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 12px 26px rgba(0, 0, 0, 0.35);
        }
        .thumb {
          height: 240px;
          overflow: hidden;
        }
        .thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .copy {
          padding: 14px;
        }
        h3 {
          margin: 0 0 6px;
          font-size: 1.3rem;
          color: #edf2ff;
        }
        p {
          margin: 0;
          color: #c2cbe2;
          line-height: 1.55;
          font-size: 1rem;
        }
        .actions {
          display: flex;
          gap: 12px;
          margin-top: 24px;
        }
        .primary,
        .ghost {
          padding: 12px 16px;
          border-radius: 10px;
          border: none;
          cursor: pointer;
          font-weight: 600;
          min-width: 160px;
        }
        .primary {
          background: linear-gradient(135deg, #2563eb, #7c3aed);
          color: #fff;
        }
        .ghost {
          background: transparent;
          color: #cbd5f5;
          border: 1px solid rgba(255, 255, 255, 0.12);
          text-decoration: none;
        }
      `}</style>
    </div>
  );
}
