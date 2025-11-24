"use client";

import Link from "next/link";

const cards = [
  {
    id: "solid-earth",
    title: "Solid Earth",
    href: "/solid-earth",
    description: "Spectral landscapes, geology, and mineral textures. PCA, MNF, and false-color blends.",
    image:
      "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "water",
    title: "Water",
    href: "/water",
    description: "Rivers, deltas, coastlines, and aquatic textures. Coming soon.",
    image:
      "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "urban",
    title: "Urban",
    href: "/urban",
    description: "Roads, buildings, and human patterns. Vector-based city art. Coming soon.",
    image:
      "https://images.unsplash.com/photo-1433838552652-f9a46b332c40?auto=format&fit=crop&w=1200&q=80",
  },
];

export default function ProductsPage() {
  return (
    <div className="products">
      <h1>Choose your world</h1>
      <p className="lede">Pick a domain to begin crafting Earthsy artwork.</p>
      <div className="grid">
        {cards.map((card) => (
          <Link key={card.id} href={card.href} className="card">
            <div className="image">
              <img src={card.image} alt={card.title} />
            </div>
            <div className="copy">
              <h2>{card.title}</h2>
              <p>{card.description}</p>
            </div>
          </Link>
        ))}
      </div>
      <style jsx>{`
        .products {
          padding: 32px;
          max-width: 1200px;
          margin: 0 auto;
        }
        .lede {
          color: #94a3b8;
          margin-top: 4px;
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
      `}</style>
    </div>
  );
}
