"use client";

import Link from "next/link";

export default function ContactPage() {
  return (
    <div className="contact">
      <h1>Contact</h1>
      <p className="lede">Have a question or want to collaborate? Reach out.</p>
      <p className="lede">hello@earthsy.art (placeholder)</p>
      <Link href="/products" className="primary">
        Back to products
      </Link>
      <style jsx>{`
        .contact {
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
