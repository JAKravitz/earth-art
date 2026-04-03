"use client";

import Link from "next/link";

const subCards = [
  {
    id: "rem",
    title: "River REM",
    href: "/water/rem/playground",
    description: "Relative elevation along rivers: floodplains, oxbows, and terraces as art.",
    image:
      "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "coastlines",
    title: "Coastlines",
    href: "#",
    description: "Coming soon.",
    image:
      "https://images.unsplash.com/photo-1505142468610-359e7d316be0?auto=format&fit=crop&w=1200&q=80",
  },
];

export default function WaterPage() {
  return (
    <div className="water-products">
      <h1>Water</h1>
      <p className="lede">Rivers, deltas, coastlines, and aquatic textures.</p>
      <div className="grid">
        {subCards.map((card) =>
          card.href === "#" ? (
            <div key={card.id} className="card disabled">
              <div className="image">
                <img src={card.image} alt={card.title} />
              </div>
              <div className="copy">
                <h2>{card.title}</h2>
                <p>{card.description}</p>
              </div>
            </div>
          ) : (
            <Link key={card.id} href={card.href} className="card">
              <div className="image">
                <img src={card.image} alt={card.title} />
              </div>
              <div className="copy">
                <h2>{card.title}</h2>
                <p>{card.description}</p>
              </div>
            </Link>
          ),
        )}
      </div>
      <Link href="/products" className="back">
        Back to products
      </Link>
      <style jsx>{`
        .water-products {
          padding: 32px;
          max-width: 1200px;
          margin: 0 auto;
        }
        .lede {
          color: #94a3b8;
          margin-top: 4px;
          margin-bottom: 24px;
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 18px;
          margin-top: 24px;
        }
        .card {
          display: flex;
          flex-direction: column;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 14px;
          overflow: hidden;
          text-decoration: none;
          color: inherit;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .card:hover {
          transform: translateY(-4px);
          box-shadow: 0 16px 30px rgba(0, 0, 0, 0.35);
        }
        .card.disabled {
          opacity: 0.7;
          cursor: default;
        }
        .image {
          height: 170px;
          overflow: hidden;
        }
        .image img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .copy {
          padding: 14px;
        }
        h2 {
          margin: 0 0 6px;
        }
        p {
          margin: 0;
          color: #cbd5f5;
        }
        .back {
          display: inline-block;
          margin-top: 24px;
          padding: 12px 18px;
          background: linear-gradient(135deg, #2563eb, #7c3aed);
          border-radius: 10px;
          color: #fff;
          text-decoration: none;
        }
      `}</style>
    </div>
  );
}
