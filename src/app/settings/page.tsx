import { Suspense } from "react";
import SettingsPageClient from "./SettingsPageClient";

function SettingsPageFallback() {
  return (
    <main className="page">
      <div className="ambient ambientA" aria-hidden />
      <div className="ambient ambientB" aria-hidden />
      <div className="container">
        <section className="hero glassCard compactHero settingsSetupHero">
          <p className="heroEyebrow">Einmal einrichten</p>
          <h1>Diese Daten erscheinen auf jedem Angebot</h1>
          <p className="heroText">
            Dein Logo sowie deine Kontakt- und Firmendaten werden automatisch in
            PDF und Mail-Entwurf übernommen.
          </p>
        </section>
      </div>
    </main>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<SettingsPageFallback />}>
      <SettingsPageClient />
    </Suspense>
  );
}
