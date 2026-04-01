"use client";

import { useEffect } from "react";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="page">
      <div className="ambient ambientA" aria-hidden />
      <div className="ambient ambientB" aria-hidden />
      <div className="container pageSurfaceTransition">
        <section
          className="glassCard"
          style={{
            maxWidth: 720,
            margin: "0 auto",
            padding: 24,
            display: "grid",
            gap: 12,
          }}
        >
          <h1
            style={{
              margin: 0,
              color: "#173968",
              lineHeight: 1.08,
            }}
          >
            Etwas ist schiefgelaufen.
          </h1>
          <p style={{ margin: 0, color: "#4f6487", lineHeight: 1.5 }}>
            Die Seite konnte nicht korrekt gerendert werden. Du kannst es direkt
            erneut versuchen, ohne die komplette App neu zu laden.
          </p>
          <div>
            <button type="button" className="primaryButton" onClick={() => reset()}>
              Erneut versuchen
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
