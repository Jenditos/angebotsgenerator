import { Suspense } from "react";
import UpgradePageClient from "./UpgradePageClient";

function UpgradePageFallback() {
  return (
    <main className="page">
      <div className="ambient ambientA" aria-hidden />
      <div className="ambient ambientB" aria-hidden />
      <div className="container pageSurfaceTransition">
        <section className="hero glassCard compactHero">
          <p className="heroEyebrow">Zugang pausiert</p>
          <h1>Ihr kostenloser Testmonat ist beendet</h1>
          <p className="heroText">Lade Zugriffsdaten ...</p>
        </section>
      </div>
    </main>
  );
}

export default function UpgradePage() {
  return (
    <Suspense fallback={<UpgradePageFallback />}>
      <UpgradePageClient />
    </Suspense>
  );
}
