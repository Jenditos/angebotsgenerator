"use client";
import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabaseClient";
import { isSupabaseConfigured } from "@/lib/supabase/config";

type AuthMode = "login" | "register" | "forgot";

function formatAuthErrorMessage(rawMessage: string): string {
  const normalized = rawMessage.trim().toLowerCase();

  if (
    normalized.includes("invalid login credentials") ||
    normalized.includes("invalid credentials")
  ) {
    return "E-Mail oder Passwort sind nicht korrekt.";
  }
  if (normalized.includes("email not confirmed")) {
    return "Bitte bestätige zuerst deine E-Mail-Adresse.";
  }
  if (normalized.includes("user already registered")) {
    return "Für diese E-Mail existiert bereits ein Konto.";
  }
  if (normalized.includes("password should be at least")) {
    return "Das Passwort ist zu kurz. Bitte mindestens 8 Zeichen verwenden.";
  }
  if (normalized.includes("too many requests")) {
    return "Zu viele Versuche. Bitte kurz warten und erneut probieren.";
  }
  if (normalized.includes("network")) {
    return "Netzwerkfehler. Bitte Verbindung prüfen und erneut versuchen.";
  }

  return rawMessage || "Authentifizierung fehlgeschlagen.";
}

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
          setError(formatAuthErrorMessage(signUpError.message));
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
          setError(formatAuthErrorMessage(resetError.message));
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
        setError(formatAuthErrorMessage(signInError.message));
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

  const isRegisterMode = mode === "register";
  const isForgotMode = mode === "forgot";
  const title = isRegisterMode
    ? "Konto erstellen"
    : isForgotMode
      ? "Passwort zurücksetzen"
      : "Bei Visioro anmelden";
  const subtitle = isRegisterMode
    ? "Starte deinen kostenlosen Testmonat sofort. Ohne Kreditkarte."
    : isForgotMode
      ? "Wir senden dir einen Link zum Zurücksetzen deines Passworts."
      : "Melde dich an, um auf deine Angebote und Rechnungen zuzugreifen.";
  const submitLabel = isSubmitting
    ? "Bitte warten ..."
    : isRegisterMode
      ? "Kostenlos starten"
      : isForgotMode
        ? "Reset-Link senden"
        : "Anmelden";

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

        <section className="authCard" aria-live="polite">
          <header className="authCardHeader">
            <h1 className="authHeading">{title}</h1>
            <p className="authSubtitle">{subtitle}</p>
          </header>

          <form onSubmit={onSubmit} className="authForm">
            {isRegisterMode ? (
              <label className="authField">
                <span className="authFieldLabel">Name</span>
                <input
                  className="authInput"
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                />
              </label>
            ) : null}

            <label className="authField">
              <span className="authFieldLabel">E-Mail</span>
              <input
                className="authInput"
                required
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
              />
            </label>

            {!isForgotMode ? (
              <label className="authField">
                <span className="authFieldLabel">Passwort</span>
                <input
                  className="authInput"
                  required
                  type="password"
                  minLength={8}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={isRegisterMode ? "new-password" : "current-password"}
                />
              </label>
            ) : null}

            <button
              type="submit"
              className="authPrimaryButton"
              disabled={!authReady || isSubmitting}
            >
              {submitLabel}
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

          <div className="authModeOptions" role="tablist" aria-label="Modus wechseln">
            <button
              type="button"
              className={`authSecondaryButton ${mode === "login" ? "active" : ""}`}
              onClick={() => setMode("login")}
              aria-pressed={mode === "login"}
            >
              Login
            </button>
            <button
              type="button"
              className={`authSecondaryButton ${mode === "register" ? "active" : ""}`}
              onClick={() => setMode("register")}
              aria-pressed={mode === "register"}
            >
              Registrierung
            </button>
            <button
              type="button"
              className={`authSecondaryButton ${mode === "forgot" ? "active" : ""}`}
              onClick={() => setMode("forgot")}
              aria-pressed={mode === "forgot"}
            >
              Passwort vergessen
            </button>
          </div>

          <footer className="authFooterNotes">
            <p className="authMuted">
              Mit der Registrierung startet ein kostenloser Testmonat ohne
              Kreditkarte und ohne automatische Abbuchung.
            </p>
          </footer>
        </section>
      </div>
    </main>
  );
}
