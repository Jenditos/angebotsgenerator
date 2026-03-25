"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export default function AuthResetPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const authReady = isSupabaseConfigured();

  const supabase = useMemo(() => {
    if (!authReady) {
      return null;
    }
    return getSupabaseBrowserClient();
  }, [authReady]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) {
      setError("Supabase ist nicht konfiguriert.");
      return;
    }

    const trimmedPassword = password.trim();
    if (!trimmedPassword || trimmedPassword.length < 8) {
      setError("Bitte ein Passwort mit mindestens 8 Zeichen eingeben.");
      return;
    }

    if (trimmedPassword !== confirmPassword.trim()) {
      setError("Die Passwörter stimmen nicht überein.");
      return;
    }

    setIsSubmitting(true);
    setError("");
    setInfo("");

    const { error: updateError } = await supabase.auth.updateUser({
      password: trimmedPassword,
    });

    if (updateError) {
      setError(updateError.message);
      setIsSubmitting(false);
      return;
    }

    setInfo("Passwort wurde aktualisiert. Du kannst dich jetzt einloggen.");
    setIsSubmitting(false);
    setPassword("");
    setConfirmPassword("");
  }

  return (
    <main className="page">
      <div className="ambient ambientA" aria-hidden />
      <div className="ambient ambientB" aria-hidden />
      <div className="container pageSurfaceTransition">
        <section className="hero glassCard compactHero">
          <p className="heroEyebrow">Sicherheit</p>
          <h1>Neues Passwort festlegen</h1>
          <p className="heroText">
            Lege hier dein neues Passwort fest, nachdem du den Reset-Link aus
            der E-Mail geöffnet hast.
          </p>
        </section>

        <section className="glassCard formCard">
          <form onSubmit={onSubmit} className="formGrid">
            <label className="field">
              <span>Neues Passwort</span>
              <input
                required
                minLength={8}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Passwort wiederholen</span>
              <input
                required
                minLength={8}
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>

            <button
              type="submit"
              className="primaryButton"
              disabled={!authReady || isSubmitting}
            >
              {isSubmitting ? "Bitte warten ..." : "Passwort speichern"}
            </button>
          </form>

          {!authReady ? (
            <p className="error">
              Supabase ist noch nicht konfiguriert. Bitte ENV-Variablen setzen.
            </p>
          ) : null}
          {error ? <p className="error">{error}</p> : null}
          {!error && info ? <p className="voiceInfo">{info}</p> : null}

          <Link href="/auth" className="ghostButton">
            Zurück zum Login
          </Link>
        </section>
      </div>
    </main>
  );
}
