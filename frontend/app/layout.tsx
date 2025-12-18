import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { EarthsySessionProvider } from "./context/EarthsySession";
import EarthsyLogo from "./components/EarthsyLogo";

export const metadata: Metadata = {
  title: "Earthsy",
  description: "Transform Earth data into artful prints",
};

function TopNav() {
  return (
    <header className="top-nav">
      <div className="nav-left">
        <Link href="/" className="brand" aria-label="Earthsy home">
          <EarthsyLogo variant="icon" priority className="brand-mark" />
        </Link>
      </div>
      <nav className="nav-links">
        <Link href="/">Home</Link>
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
        <EarthsySessionProvider>
          <TopNav />
          <main className="app-shell">{children}</main>
        </EarthsySessionProvider>
      </body>
    </html>
  );
}
