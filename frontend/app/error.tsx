"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div style={{ padding: 24 }}>
      <h2>Something went wrong.</h2>
      <p>{error.message}</p>
      <button onClick={reset} type="button">
        Try again
      </button>
    </div>
  );
}
