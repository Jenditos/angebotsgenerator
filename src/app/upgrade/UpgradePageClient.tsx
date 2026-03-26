"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabaseClient";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { MONTHLY_PRICE_LABEL } from "@/lib/stripe/config";

type AccessStatusResponse = {
  authenticated?: boolean;
  access?: {
    trial_start: string;
    trial_end: string;
    subscription_status: string;
    plan: string;
  };
  state?: {
    trialActive: boolean;
    hasSubscription: boolean;
    canUseApp: boolean;
  };
  error?: string;
};

export default function UpgradePageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [isStartingCheckout, setIsStartingCheckout] = useState(false);
  const [trialEnd, setTrialEnd] = useState("");
  const [error, setError] = useState("");
  const authReady = isSupabaseConfigured();

  const checkoutStatus = searchParams.get("checkout");

  const supabase = useMemo(() => {
    if (!authReady) {
      return null;
    }
    return getSupabaseBrowserClient();
  }, [authReady]);

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      try {
        const response = await fetch("/api/access/status", {
          cache: "no-store",
        });
        const payload = (await response.json()) as AccessStatusResponse;

        if (cancelled) {
          return;
        }

        if (!response.ok || !payload.authenticated) {
          router.replace("/auth");
          return;
        }

        if (payload.state?.canUseApp) {
          router.replace("/");
          return;
        }

        if (payload.access?.trial_end) {
          setTrialEnd(payload.access.trial_end);
        }
      } catch {
        if (!cancelled) {
          setError("Zugriffsstatus konnte nicht geladen werden.");
        }
      } finally {
        if (!cancelled) {
          setLoadingStatus(false);
        }
      }
    }

    void loadStatus();

    return () => {
      cancelled = true;
    };
  }, [router]);

  async function startCheckout() {
    setIsStartingCheckout(true);
    setError("");

    try {
      const response = await fetch("/api/billing/create-checkout-session", {
        method: "POST",
      });
      const payload = (await response.json()) as { url?: string; error?: string };

      if (!response.ok || !payload.url) {
        setError(payload.error || "Checkout konnte nicht gestartet werden.");
        setIsStartingCheckout(false);
        return;
      }

      window.location.href = payload.url;
    } catch {
      setError("Checkout konnte nicht gestartet werden.");
      setIsStartingCheckout(false);
    }
  }

  async function logout() {
    if (!supabase) {
      router.replace("/auth");
      return;
    }
    await supabase.auth.signOut();
    router.replace("/auth");
  }

  const trialEndLabel = trialEnd
    ? new Date(trialEnd).toLocaleDateString("de-DE")
    : "nicht verfügbar";

  return (
    <main className="page">
      <div className="ambient ambientA" aria-hidden />
      <div className="ambient ambientB" aria-hidden />
      <div className="container pageSurfaceTransition">
        <section className="hero glassCard compactHero">
          <p className="heroEyebrow">Zugang pausiert</p>
          <h1>Ihr kostenloser Testmonat ist beendet</h1>
          <p className="heroText">
            Testzeitraum bis: {trialEndLabel}. Für die weitere Nutzung kannst du
            jetzt aktiv ein Monatsabo abschließen.
          </p>
        </section>

        <section className="glassCard formCard">
          <p className="voiceInfo">
            Preis: <strong>{MONTHLY_PRICE_LABEL}</strong>
          </p>
          <p className="voiceInfo">
            Keine automatische Abbuchung aus dem Testmonat. Ein Abo startet nur,
            wenn du jetzt aktiv auf „Jetzt abonnieren“ klickst.
          </p>

          <button
            type="button"
            className="primaryButton"
            disabled={loadingStatus || isStartingCheckout}
            onClick={() => void startCheckout()}
          >
            {isStartingCheckout ? "Weiter zu Stripe ..." : "Jetzt abonnieren"}
          </button>

          {checkoutStatus === "success" ? (
            <p className="voiceInfo">
              Zahlung erfolgreich. Dein Zugriff wird in wenigen Sekunden
              aktiviert.
            </p>
          ) : null}
          {checkoutStatus === "cancel" ? (
            <p className="voiceInfo">Checkout wurde abgebrochen.</p>
          ) : null}
          {error ? <p className="error">{error}</p> : null}

          <button type="button" className="ghostButton" onClick={() => void logout()}>
            Abmelden
          </button>
        </section>
      </div>
    </main>
  );
}
