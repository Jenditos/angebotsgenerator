"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabaseClient";
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
    <main className="authViewport">
      <div className="authGlow authGlowA" aria-hidden />
      <div className="authGlow authGlowB" aria-hidden />
      <div className="authCenterWrap">
        <div className="authBrandBlock" aria-label="Visioro">
          <span className="authBrandIcon" aria-hidden>
            V
          </span>
          <span className="authBrandWordmark">Visioro</span>
        </div>

        <section className="authCard">
          <header className="authCardHeader">
            <h1 className="authHeading">Neues Passwort festlegen</h1>
            <p className="authSubtitle">
              Lege hier dein neues Passwort fest, nachdem du den Reset-Link aus
              der E-Mail geöffnet hast.
            </p>
          </header>

          <form onSubmit={onSubmit} className="authForm">
            <label className="authField">
              <span className="authFieldLabel">Neues Passwort</span>
              <input
                className="authInput"
                required
                minLength={8}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <label className="authField">
              <span className="authFieldLabel">Passwort wiederholen</span>
              <input
                className="authInput"
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
              className="authPrimaryButton"
              disabled={!authReady || isSubmitting}
            >
              {isSubmitting ? "Bitte warten ..." : "Passwort speichern"}
            </button>
          </form>

          {!authReady ? (
            <p className="authError">
              Supabase ist noch nicht konfiguriert. Bitte ENV-Variablen setzen.
            </p>
          ) : null}
          {error ? <p className="authError">{error}</p> : null}
          {!error && info ? <p className="authInfo">{info}</p> : null}

          <div className="authDivider" role="separator" aria-label="oder">
            <span>oder</span>
          </div>

          <Link href="/auth" className="authSecondaryButton authSecondaryLink">
            Zurück zum Login
          </Link>
        </section>
      </div>
    </main>
  );
}
