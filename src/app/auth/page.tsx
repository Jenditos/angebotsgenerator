"use client";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { VisioroLogoImage } from "@/components/VisioroLogoImage";
import { ONBOARDING_SNOOZE_COOKIE_NAME } from "@/lib/onboarding";
import { getSupabaseBrowserClient } from "@/lib/supabaseClient";
import { isSupabaseConfigured } from "@/lib/supabase/config";

type AuthMode = "login" | "register" | "forgot";
const DEFAULT_EMAIL_ACTION_COOLDOWN_MS = 60_000;
const MAX_EMAIL_ACTION_COOLDOWN_MS = 15 * 60_000;

function isEmailRateLimitMessage(rawMessage: string): boolean {
  const normalized = rawMessage.trim().toLowerCase();
  return (
    normalized.includes("security purposes") ||
    normalized.includes("rate limit") ||
    normalized.includes("only request this after")
  );
}

function parseRetryAfterMsFromMessage(rawMessage: string): number | null {
  const normalized = rawMessage.trim().toLowerCase();
  const amountMatch = normalized.match(
    /after\s+(\d+)\s*(second|seconds|sec|minute|minutes|min)\b/,
  );
  if (!amountMatch) {
    return null;
  }

  const amount = Number(amountMatch[1]);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const unit = amountMatch[2];
  const factor = unit.startsWith("min") ? 60_000 : 1_000;
  return Math.min(MAX_EMAIL_ACTION_COOLDOWN_MS, amount * factor);
}

function resolveEmailActionCooldownMs(rawMessage: string): number {
  return (
    parseRetryAfterMsFromMessage(rawMessage) ?? DEFAULT_EMAIL_ACTION_COOLDOWN_MS
  );
}

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
  if (isEmailRateLimitMessage(rawMessage)) {
    return "Zu viele E-Mail-Anfragen in kurzer Zeit. Bitte kurz warten und dann erneut versuchen.";
  }
  if (normalized.includes("network")) {
    return "Netzwerkfehler. Bitte Verbindung prüfen und erneut versuchen.";
  }

  return rawMessage || "Authentifizierung fehlgeschlagen.";
}

function likelyExistingSupabaseUser(
  user: { identities?: Array<unknown> | null } | null | undefined,
): boolean {
  return Array.isArray(user?.identities) && user.identities.length === 0;
}

function resolveAuthCallbackUrl(): string {
  const envBase = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim();
  if (envBase) {
    return `${envBase.replace(/\/+$/, "")}/auth/callback`;
  }

  return `${window.location.origin}/auth/callback`;
}

async function readApiErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown } | null;
    if (payload && typeof payload.error === "string" && payload.error.trim()) {
      return payload.error.trim();
    }
  } catch {
    // Ignore JSON parse errors and use fallback below.
  }

  if (response.status === 401) {
    return "Sitzung konnte serverseitig nicht bestätigt werden. Bitte erneut einloggen.";
  }
  if (response.status >= 500) {
    return "Testzugang konnte serverseitig nicht initialisiert werden.";
  }
  return "Testzugang konnte nicht gestartet werden.";
}

function clearOnboardingSnoozeCookie(): void {
  if (typeof document === "undefined") {
    return;
  }
  document.cookie = `${ONBOARDING_SNOOZE_COOKIE_NAME}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; samesite=lax`;
}

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pendingConfirmationEmail, setPendingConfirmationEmail] = useState("");
  const [isResendingConfirmation, setIsResendingConfirmation] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [emailActionCooldownUntil, setEmailActionCooldownUntil] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const authReady = isSupabaseConfigured();

  const supabase = useMemo(() => {
    if (!authReady) {
      return null;
    }
    return getSupabaseBrowserClient();
  }, [authReady]);

  useEffect(() => {
    if (emailActionCooldownUntil <= Date.now()) {
      return;
    }

    const timer = window.setInterval(() => {
      const currentTime = Date.now();
      setNowMs(currentTime);
      if (currentTime >= emailActionCooldownUntil) {
        window.clearInterval(timer);
      }
    }, 1_000);

    return () => window.clearInterval(timer);
  }, [emailActionCooldownUntil]);

  const emailActionCooldownSeconds = Math.max(
    0,
    Math.ceil((emailActionCooldownUntil - nowMs) / 1_000),
  );
  const isEmailActionCoolingDown = emailActionCooldownSeconds > 0;

  function startEmailActionCooldown(cooldownMs: number): void {
    setNowMs(Date.now());
    setEmailActionCooldownUntil((previousUntil) =>
      Math.max(previousUntil, Date.now() + cooldownMs),
    );
  }

  function applyEmailActionRateLimitFeedback(rawMessage: string): void {
    const cooldownMs = resolveEmailActionCooldownMs(rawMessage);
    startEmailActionCooldown(cooldownMs);
    const seconds = Math.ceil(cooldownMs / 1_000);
    setError(
      `Zu viele E-Mail-Anfragen in kurzer Zeit. Bitte warte ${seconds} Sekunden und versuche es dann erneut.`,
    );
  }

  async function bootstrapTrial(): Promise<void> {
    const response = await fetch("/api/access/bootstrap", {
      method: "POST",
    });
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    if (!response.ok) {
      throw new Error(payload.error || "Testzugang konnte nicht gestartet werden.");
    }
  }

  async function resendConfirmationEmail() {
    if (!supabase) {
      setError("Supabase ist nicht konfiguriert.");
      return;
    }

    const targetEmail = pendingConfirmationEmail.trim().toLowerCase();
    if (!targetEmail) {
      setError("Bitte gib zuerst eine E-Mail-Adresse ein.");
      return;
    }

    setIsResendingConfirmation(true);
    setError("");
    setInfo("");

    try {
      if (isEmailActionCoolingDown) {
        setError(
          `Bitte warte ${emailActionCooldownSeconds} Sekunden, bevor du erneut eine E-Mail anforderst.`,
        );
        return;
      }

      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email: targetEmail,
        options: {
          emailRedirectTo: resolveAuthCallbackUrl(),
        },
      });
      if (resendError) {
        if (isEmailRateLimitMessage(resendError.message)) {
          applyEmailActionRateLimitFeedback(resendError.message);
          return;
        }
        setError(formatAuthErrorMessage(resendError.message));
        return;
      }

      startEmailActionCooldown(DEFAULT_EMAIL_ACTION_COOLDOWN_MS);
      setInfo(
        `Bestätigungs-Mail erneut gesendet an ${targetEmail}. Bitte auch Spam-Ordner prüfen.`,
      );
    } catch (resendFailure) {
      setError(
        resendFailure instanceof Error
          ? resendFailure.message
          : "Bestätigungs-Mail konnte nicht erneut gesendet werden.",
      );
    } finally {
      setIsResendingConfirmation(false);
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
      if ((mode === "register" || mode === "forgot") && isEmailActionCoolingDown) {
        setError(
          `Bitte warte ${emailActionCooldownSeconds} Sekunden, bevor du erneut eine E-Mail-Aktion startest.`,
        );
        return;
      }

      if (mode === "register") {
        const trimmedName = name.trim();
        const trimmedEmail = email.trim().toLowerCase();
        if (!trimmedName) {
          setError("Bitte gib deinen Namen ein.");
          return;
        }

        const { data, error: signUpError } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
          options: {
            data: {
              full_name: trimmedName,
            },
            emailRedirectTo: resolveAuthCallbackUrl(),
          },
        });

        if (signUpError) {
          const normalizedSignUpError = signUpError.message.toLowerCase();
          if (normalizedSignUpError.includes("already registered")) {
            setPendingConfirmationEmail(trimmedEmail);
          }

          if (isEmailRateLimitMessage(signUpError.message)) {
            const { error: signInRecoveryError } =
              await supabase.auth.signInWithPassword({
                email: trimmedEmail,
                password,
              });

            if (!signInRecoveryError) {
              setPendingConfirmationEmail("");
              await bootstrapTrial();
              clearOnboardingSnoozeCookie();
              router.replace("/");
              router.refresh();
              return;
            }

            if (
              signInRecoveryError.message
                .toLowerCase()
                .includes("email not confirmed")
            ) {
              setPendingConfirmationEmail(trimmedEmail);
              startEmailActionCooldown(
                resolveEmailActionCooldownMs(signUpError.message),
              );
              setInfo(
                "Konto wurde angelegt, aber die Bestätigungs-Mail ist aktuell rate-limitiert. Bitte kurz warten und danach erneut bestätigen.",
              );
              setMode("login");
              return;
            }

            applyEmailActionRateLimitFeedback(signUpError.message);
            return;
          }

          setError(formatAuthErrorMessage(signUpError.message));
          return;
        }

        if (data.session) {
          setPendingConfirmationEmail("");
          await bootstrapTrial();
          clearOnboardingSnoozeCookie();
          router.replace("/");
          router.refresh();
          return;
        }

        if (likelyExistingSupabaseUser(data.user)) {
          setPendingConfirmationEmail(trimmedEmail);
          setInfo(
            "Für diese E-Mail existiert bereits ein Konto. Bitte einloggen oder Passwort zurücksetzen. Falls das Konto noch unbestätigt ist, kannst du unten die Bestätigungs-Mail erneut senden.",
          );
          setMode("login");
          return;
        }

        setPendingConfirmationEmail(trimmedEmail);
        setInfo(
          "Registrierung erfolgreich. Bitte bestätige deine E-Mail-Adresse (auch Spam prüfen) und melde dich danach an.",
        );
        setMode("login");
        return;
      }

      if (mode === "forgot") {
        const resetRedirect = `${resolveAuthCallbackUrl()}?next=%2Fauth%2Freset`;
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(
          email.trim(),
          {
            redirectTo: resetRedirect,
          },
        );

        if (resetError) {
          if (isEmailRateLimitMessage(resetError.message)) {
            applyEmailActionRateLimitFeedback(resetError.message);
            return;
          }
          setError(formatAuthErrorMessage(resetError.message));
          return;
        }

        startEmailActionCooldown(DEFAULT_EMAIL_ACTION_COOLDOWN_MS);
        setInfo("Wenn die E-Mail bekannt ist, wurde ein Reset-Link versendet.");
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        if (signInError.message.toLowerCase().includes("email not confirmed")) {
          setPendingConfirmationEmail(email.trim().toLowerCase());
        }
        setError(formatAuthErrorMessage(signInError.message));
        return;
      }

      setPendingConfirmationEmail("");
      await bootstrapTrial();
      clearOnboardingSnoozeCookie();
      router.replace("/");
      router.refresh();
    } catch (submitError) {
      console.error("[auth] submit failed", submitError);
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
  const canResendConfirmation =
    !isForgotMode &&
    authReady &&
    Boolean(pendingConfirmationEmail.trim());
  const submitLabel = isSubmitting
    ? "Bitte warten ..."
    : isRegisterMode
      ? "Konto erstellen"
      : isForgotMode
        ? "Reset-Link senden"
        : "Einloggen";
  const isEmailMode = isRegisterMode || isForgotMode;

  return (
    <main className="authViewport authGithubViewport">
      <div className="authGithubCenter">
        <div className="authGithubLogoRow" aria-label="Visioro">
          <VisioroLogoImage className="authGithubLogoImage" />
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
              disabled={!authReady || isSubmitting || (isEmailMode && isEmailActionCoolingDown)}
            >
              {isEmailMode && isEmailActionCoolingDown
                ? `Bitte warten (${emailActionCooldownSeconds}s)`
                : submitLabel}
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
          {canResendConfirmation ? (
            <p className="authGithubSignupHint">
              Keine Bestätigungs-Mail erhalten?{" "}
              <button
                type="button"
                className="authGithubInlineLink authGithubInlineLinkStrong"
                onClick={() => void resendConfirmationEmail()}
                disabled={isSubmitting || isResendingConfirmation || isEmailActionCoolingDown}
              >
                {isResendingConfirmation
                  ? "Wird gesendet ..."
                  : isEmailActionCoolingDown
                    ? `Erneut senden in ${emailActionCooldownSeconds}s`
                  : "Bestätigungs-Mail erneut senden"}
              </button>
            </p>
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
