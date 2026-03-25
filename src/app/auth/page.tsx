"use client";
import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

type AuthMode = "login" | "register" | "forgot";

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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

  async function bootstrapTrial(): Promise<void> {
    const response = await fetch("/api/access/bootstrap", {
      method: "POST",
    });
    if (!response.ok) {
      throw new Error("Testzugang konnte nicht gestartet werden.");
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) {
      setError("Supabase ist nicht konfiguriert.");
      return;
    }

    setIsSubmitting(true);
    setError("");
    setInfo("");

    try {
      if (mode === "register") {
        const trimmedName = name.trim();
        if (!trimmedName) {
          setError("Bitte gib deinen Namen ein.");
          return;
        }

        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              full_name: trimmedName,
            },
          },
        });

        if (signUpError) {
          setError(signUpError.message);
          return;
        }

        if (data.session) {
          await bootstrapTrial();
          router.replace("/");
          router.refresh();
          return;
        }

        setInfo(
          "Registrierung erfolgreich. Bitte bestätige deine E-Mail-Adresse und melde dich danach an.",
        );
        setMode("login");
        return;
      }

      if (mode === "forgot") {
        const resetRedirect = `${window.location.origin}/auth/reset`;
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(
          email.trim(),
          {
            redirectTo: resetRedirect,
          },
        );

        if (resetError) {
          setError(resetError.message);
          return;
        }

        setInfo("Wenn die E-Mail bekannt ist, wurde ein Reset-Link versendet.");
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        setError(signInError.message);
        return;
      }

      await bootstrapTrial();
      router.replace("/");
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Anmeldung konnte nicht abgeschlossen werden.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="page">
      <div className="ambient ambientA" aria-hidden />
      <div className="ambient ambientB" aria-hidden />
      <div className="container pageSurfaceTransition">
        <section className="hero glassCard compactHero">
          <p className="heroEyebrow">Sofort starten</p>
          <h1>Kostenlos testen, ohne Kreditkarte</h1>
          <p className="heroText">
            Registriere dich mit Name, E-Mail und Passwort. Dein unverbindlicher
            Testmonat startet automatisch und ohne Zahlungsdaten.
          </p>
        </section>

        <section className="glassCard formCard">
          <div
            className="documentModeSwitch"
            role="tablist"
            aria-label="Authentifizierung"
          >
            <button
              type="button"
              className={`documentModeSwitchButton ${mode === "login" ? "active" : ""}`}
              onClick={() => setMode("login")}
              aria-pressed={mode === "login"}
            >
              Login
            </button>
            <button
              type="button"
              className={`documentModeSwitchButton ${mode === "register" ? "active" : ""}`}
              onClick={() => setMode("register")}
              aria-pressed={mode === "register"}
            >
              Registrierung
            </button>
            <button
              type="button"
              className={`documentModeSwitchButton ${mode === "forgot" ? "active" : ""}`}
              onClick={() => setMode("forgot")}
              aria-pressed={mode === "forgot"}
            >
              Passwort vergessen
            </button>
          </div>

          <form onSubmit={onSubmit} className="formGrid">
            {mode === "register" ? (
              <label className="field">
                <span>Name</span>
                <input
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                />
              </label>
            ) : null}

            <label className="field">
              <span>E-Mail</span>
              <input
                required
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
              />
            </label>

            {mode !== "forgot" ? (
              <label className="field">
                <span>Passwort</span>
                <input
                  required
                  type="password"
                  minLength={8}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={mode === "register" ? "new-password" : "current-password"}
                />
              </label>
            ) : null}

            <button
              type="submit"
              className="primaryButton"
              disabled={!authReady || isSubmitting}
            >
              {isSubmitting
                ? "Bitte warten ..."
                : mode === "register"
                  ? "Jetzt kostenlos starten"
                  : mode === "forgot"
                    ? "Reset-Link senden"
                    : "Einloggen"}
            </button>
          </form>

          {!authReady ? (
            <p className="error">
              Supabase ist noch nicht konfiguriert. Bitte ENV-Variablen setzen.
            </p>
          ) : null}
          {error ? <p className="error">{error}</p> : null}
          {!error && info ? (
            <p className="voiceInfo" role="status">
              {info}
            </p>
          ) : null}

          <p className="voiceInfo">
            Mit der Registrierung startet ein kostenloser Testmonat ohne
            Kreditkarte und ohne automatische Abbuchung.
          </p>

        </section>
      </div>
    </main>
  );
}
