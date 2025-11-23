"use client";

import Link from "next/link";

export default function WaterPage() {
  return (
    <div className="coming">
      <h1>Water</h1>
      <p className="lede">Coming soon. Rivers, deltas, coastlines, and aquatic textures.</p>
      <Link href="/products" className="primary">
        Back to products
      </Link>
      <style jsx>{`
        .coming {
          padding: 40px;
          text-align: center;
        }
        .lede {
          color: #94a3b8;
          margin-bottom: 16px;
        }
        .primary {
          display: inline-block;
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
