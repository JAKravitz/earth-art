"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const heroImages = [
  "https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=1600&q=80",
  "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1600&q=80",
  "https://images.unsplash.com/photo-1497906539264-eb74442e37ab?auto=format&fit=crop&w=1600&q=80",
];

export default function LandingPage() {
  const [heroIndex, setHeroIndex] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setHeroIndex((i) => (i + 1) % heroImages.length);
    }, 4000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="landing">
      <div className="hero-image">
        <img src={heroImages[heroIndex]} alt="Earth art hero" />
      </div>
      <div className="hero-copy">
        <h1>Earthsy</h1>
        <p className="lede">
          Earthsy turns real satellite and geospatial data into custom artwork. Explore landscapes, rivers, and cities and
          transform them into unique prints.
        </p>
        <div className="cta-group">
          <Link className="primary" href="/products">
            Get started
          </Link>
          <Link className="ghost" href="/solid-earth">
            See a live example
          </Link>
        </div>
        <p className="hint">Choose a world to begin creating.</p>
      </div>
      <style jsx>{`
        .landing {
          display: grid;
          grid-template-columns: 1.2fr 1fr;
          min-height: calc(100vh - 72px);
          padding: 32px;
          gap: 24px;
          background: radial-gradient(circle at 20% 20%, rgba(37, 99, 235, 0.1), transparent 35%),
            radial-gradient(circle at 80% 0%, rgba(124, 58, 237, 0.12), transparent 30%),
            #0b0f19;
        }
        .hero-image {
          position: relative;
          border-radius: 18px;
          overflow: hidden;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.35);
          min-height: 420px;
        }
        .hero-image img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          transition: opacity 0.8s ease;
        }
        .hero-copy {
          display: flex;
          flex-direction: column;
          gap: 14px;
          align-self: center;
          padding: 12px;
        }
        h1 {
          margin: 0;
          font-size: 3rem;
        }
        .lede {
          color: #cbd5f5;
          line-height: 1.6;
        }
        .cta-group {
          display: flex;
          gap: 12px;
          align-items: center;
          margin-top: 8px;
        }
        .primary,
        .ghost {
          padding: 12px 18px;
          border-radius: 10px;
          text-decoration: none;
          font-weight: 600;
        }
        .primary {
          background: linear-gradient(135deg, #2563eb, #7c3aed);
          color: #fff;
        }
        .ghost {
          color: #cbd5f5;
          border: 1px solid rgba(255, 255, 255, 0.08);
        }
        .ghost:hover {
          border-color: rgba(255, 255, 255, 0.2);
        }
        .hint {
          color: #94a3b8;
          margin-top: 4px;
        }
        @media (max-width: 960px) {
          .landing {
            grid-template-columns: 1fr;
            padding: 20px;
          }
          .hero-copy {
            order: 2;
          }
          .hero-image {
            order: 1;
            min-height: 260px;
          }
        }
      `}</style>
    </div>
  );
}
