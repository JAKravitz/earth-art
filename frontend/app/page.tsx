"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import EarthsyLogo from "./components/EarthsyLogo";

const heroImages = [
  "https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=1600&q=80",
  "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1600&q=80",
];

export default function LandingPage() {
  const [heroIndex, setHeroIndex] = useState(0);
  const [fixedImage, setFixedImage] = useState(heroImages[0]);
  useEffect(() => {
    const id = setInterval(() => {
      setHeroIndex((i) => (i + 1) % heroImages.length);
      setFixedImage((prev) => heroImages[(heroImages.indexOf(prev) + 1) % heroImages.length]);
    }, 7000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="landing">
      <div className="hero-image">
        <img src={fixedImage} alt="Earth art hero" />
      </div>
      <div className="hero-copy">
        <h1 className="title">
          <EarthsyLogo variant="wordmark" priority className="hero-logo" />
          <span className="sr-only">Earthsy</span>
        </h1>
        <p className="lede">
          <EarthsyLogo variant="icon" className="inline-logo" />
          <span className="sr-only">Earthsy</span> turns real satellite and geospatial data into custom artwork. Explore
          landscapes, rivers, and cities and transform them into unique prints.
        </p>
        <div className="cta-group">
          <Link className="primary btn" href="/products">
            Get started
          </Link>
          <Link className="ghost btn" href="/solid-earth">
            See a live example
          </Link>
        </div>
        <p className="hint">Choose a world to begin creating.</p>
      </div>
      <style jsx>{`
        .landing {
          display: grid;
          grid-template-columns: 1.2fr 1fr;
          height: calc(100vh - 64px);
          padding: 32px 28px;
          gap: 24px;
          background: radial-gradient(circle at 20% 20%, rgba(37, 99, 235, 0.1), transparent 35%),
            radial-gradient(circle at 80% 0%, rgba(124, 58, 237, 0.12), transparent 30%),
            #0b0f19;
          overflow: hidden;
        }
        .hero-image {
          position: relative;
          border-radius: 18px;
          overflow: hidden;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.35);
          height: 70vh;
          min-height: 480px;
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
        .title {
          margin: 0;
          display: inline-flex;
          align-items: center;
          gap: 10px;
        }
        .hero-logo {
          height: 96px;
          width: auto;
          max-width: 100%;
          object-fit: contain;
        }
        .lede {
          color: #cbd5f5;
          line-height: 1.6;
          display: flex;
          gap: 10px;
          align-items: center;
        }
        .inline-logo {
          height: 32px;
          width: auto;
          object-fit: contain;
        }
        .cta-group {
          display: flex;
          gap: 16px;
          align-items: center;
          margin-top: 8px;
        }
        :global(a.btn) {
          padding: 14px 22px;
          border-radius: 10px;
          font-weight: 600;
          font-size: 1.05rem;
          border: 1px solid rgba(255, 255, 255, 0.1);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 160px;
          transition: transform 0.15s ease, box-shadow 0.2s ease, border-color 0.2s ease;
          text-decoration: none;
        }
        :global(a.primary) {
          background: linear-gradient(135deg, #2563eb, #7c3aed);
          color: #fff;
          box-shadow: 0 10px 24px rgba(37, 99, 235, 0.3);
        }
        :global(a.primary:hover) {
          transform: translateY(-2px);
          box-shadow: 0 14px 28px rgba(37, 99, 235, 0.4);
        }
        :global(a.ghost) {
          color: #cbd5f5;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(255, 255, 255, 0.02);
        }
        :global(a.ghost:hover) {
          border-color: rgba(255, 255, 255, 0.3);
          transform: translateY(-2px);
        }
        .hint {
          color: #94a3b8;
          margin-top: 4px;
        }
        @media (min-width: 768px) {
          .hero-logo {
            height: 128px;
          }
        }
        @media (max-width: 960px) {
          .landing {
            grid-template-columns: 1fr;
            padding: 20px;
            height: auto;
          }
          .hero-copy {
            order: 2;
          }
          .hero-image {
            order: 1;
            height: 320px;
            min-height: 320px;
          }
        }
      `}</style>
    </div>
  );
}
