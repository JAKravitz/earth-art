import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Earthsy",
  description: "Transform Earth data into artful prints",
};

function TopNav() {
  return (
    <header className="top-nav">
      <div className="nav-left">
        <Link href="/" className="brand">
          Earthsy
        </Link>
      </div>
      <nav className="nav-links">
        <Link href="/products">Products</Link>
        <Link href="/contact">Contact</Link>
      </nav>
    </header>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TopNav />
        <main className="app-shell">{children}</main>
      </body>
    </html>
  );
}
