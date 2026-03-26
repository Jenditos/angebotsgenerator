"use client";
import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { VisioroLogoPill } from "@/components/VisioroLogoPill";
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
  const submitLabel = isSubmitting
    ? "Bitte warten ..."
    : isRegisterMode
      ? "Konto erstellen"
      : isForgotMode
        ? "Reset-Link senden"
        : "Einloggen";

  function showSocialLoginInfo(provider: "Google" | "Apple") {
    setError("");
    setInfo(`Login mit ${provider} ist aktuell noch nicht verfügbar.`);
  }

  return (
    <main className="authViewport authGithubViewport">
      <div className="authGithubCenter">
        <div className="authGithubLogoRow" aria-label="Visioro">
          <VisioroLogoPill className="authGithubLogo" />
        </div>

        <section className="authGithubCard" aria-live="polite">
          {isRegisterMode ? (
            <p className="authGithubModeIntro">
              Konto erstellen
              <span>Starte deinen kostenlosen Testmonat ohne Kreditkarte.</span>
            </p>
          ) : isForgotMode ? (
            <p className="authGithubModeIntro">
              Passwort zurücksetzen
              <span>Wir senden dir einen Link zum Zurücksetzen.</span>
            </p>
          ) : null}

          <form onSubmit={onSubmit} className="authGithubForm">
            {isRegisterMode ? (
              <label className="authGithubField">
                <span className="authGithubLabel">Name</span>
                <input
                  className="authGithubInput"
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                />
              </label>
            ) : null}

            <label className="authGithubField">
              <span className="authGithubLabel">E-Mail-Adresse</span>
              <input
                className="authGithubInput"
                required
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
              />
            </label>

            {!isForgotMode ? (
              <>
                <div className="authGithubPasswordRow">
                  <span className="authGithubLabel">Passwort</span>
                  <button
                    type="button"
                    className="authGithubInlineLink"
                    onClick={() => setMode("forgot")}
                  >
                    Passwort vergessen?
                  </button>
                </div>
                <input
                  className="authGithubInput"
                  required
                  type="password"
                  minLength={8}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={isRegisterMode ? "new-password" : "current-password"}
                />
              </>
            ) : null}

            <button
              type="submit"
              className="authGithubPrimaryButton"
              disabled={!authReady || isSubmitting}
            >
              {submitLabel}
            </button>
          </form>

          {!authReady ? (
            <p className="authGithubMessage authGithubMessageError">
              Supabase ist noch nicht konfiguriert. Bitte ENV-Variablen setzen.
            </p>
          ) : null}
          {error ? (
            <p className="authGithubMessage authGithubMessageError">{error}</p>
          ) : null}
          {!error && info ? (
            <p className="authGithubMessage authGithubMessageInfo">{info}</p>
          ) : null}

          {!isForgotMode ? (
            <>
              <div className="authGithubDivider" role="separator" aria-label="oder">
                <span>oder</span>
              </div>

              <div className="authGithubSocialStack">
                <button
                  type="button"
                  className="authGithubSocialButton"
                  onClick={() => showSocialLoginInfo("Google")}
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="authGithubSocialIcon"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path
                      d="M21.8 12.2c0-.7-.1-1.3-.2-1.9H12v3.7h5.5a4.6 4.6 0 0 1-2.1 3v2.5h3.4c2-1.8 3-4.4 3-7.3Z"
                      fill="#4285F4"
                    />
                    <path
                      d="M12 22c2.7 0 5-0.9 6.8-2.5l-3.4-2.5c-.9.7-2.1 1.2-3.4 1.2-2.6 0-4.7-1.7-5.4-4H3v2.6A10 10 0 0 0 12 22Z"
                      fill="#34A853"
                    />
                    <path
                      d="M6.6 14.2a6 6 0 0 1 0-3.8V7.8H3a10 10 0 0 0 0 8.8l3.6-2.4Z"
                      fill="#FBBC04"
                    />
                    <path
                      d="M12 5.8c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 3 7.8l3.6 2.6c.7-2.3 2.8-4.6 5.4-4.6Z"
                      fill="#EA4335"
                    />
                  </svg>
                  <span>Weiter mit Google</span>
                </button>

                <button
                  type="button"
                  className="authGithubSocialButton"
                  onClick={() => showSocialLoginInfo("Apple")}
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="authGithubSocialIcon"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path
                      d="M15.1 6.1c.8-1 1.4-2.3 1.2-3.6-1.2.1-2.6.8-3.5 1.8-.8.9-1.4 2.2-1.3 3.4 1.3.1 2.7-.6 3.6-1.6Zm3.9 11.8c-.6 1.3-.8 1.9-1.6 3.1-1.1 1.7-2.6 3.8-4.4 3.8-1.6 0-2-.9-4.2-.9s-2.7.9-4.2.9c-1.8 0-3.2-1.8-4.3-3.5C-2.7 16.8-2 9.1 2.5 6.4c1.6-1 3.4-1.6 5.1-1.6 1.8 0 2.9.9 4.4.9 1.4 0 2.3-.9 4.3-.9 1.5 0 3 .4 4.1 1.2-3.7 2-3.1 7.2-1.4 9.6Z"
                      fill="currentColor"
                    />
                  </svg>
                  <span>Weiter mit Apple</span>
                </button>
              </div>
            </>
          ) : null}

          {isForgotMode ? (
            <p className="authGithubSignupHint">
              Zurück zum{" "}
              <button
                type="button"
                className="authGithubInlineLink authGithubInlineLinkStrong"
                onClick={() => setMode("login")}
              >
                Login
              </button>
            </p>
          ) : mode === "login" ? (
            <p className="authGithubSignupHint">
              Neu bei Visioro?{" "}
              <button
                type="button"
                className="authGithubInlineLink authGithubInlineLinkStrong"
                onClick={() => setMode("register")}
              >
                Konto erstellen
              </button>
            </p>
          ) : (
            <p className="authGithubSignupHint">
              Bereits bei Visioro?{" "}
              <button
                type="button"
                className="authGithubInlineLink authGithubInlineLinkStrong"
                onClick={() => setMode("login")}
              >
                Einloggen
              </button>
            </p>
          )}

          {!isForgotMode ? (
            <button
              type="button"
              className="authGithubPasskeyButton"
              onClick={() => {
                setError("");
                setInfo("Mit Passkey anmelden ist aktuell noch nicht verfügbar.");
              }}
            >
              Mit Passkey anmelden
            </button>
          ) : null}
        </section>
      </div>
    </main>
  );
}
