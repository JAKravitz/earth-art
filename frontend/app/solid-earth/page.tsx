"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { SOLID_EARTH_LOCATIONS } from "./locations";

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
          Search your own
        </Link>
      </div>
      <style jsx>{`
        .solid-landing {
          padding: 32px;
          max-width: 1200px;
          margin: 0 auto;
        }
        .lede {
          color: #94a3b8;
        }
        .locations {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 16px;
          margin-top: 18px;
        }
        .loc-card {
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
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
          height: 150px;
          overflow: hidden;
        }
        .thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .copy {
          padding: 12px;
        }
        .actions {
          display: flex;
          gap: 12px;
          margin-top: 20px;
        }
        .primary,
        .ghost {
          padding: 12px 16px;
          border-radius: 10px;
          border: none;
          cursor: pointer;
          font-weight: 600;
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
