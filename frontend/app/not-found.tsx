import Link from "next/link";

export default function NotFound() {
  return (
    <div style={{ padding: 24 }}>
      <h2>Page not found.</h2>
      <Link href="/">Return home</Link>
    </div>
  );
}
