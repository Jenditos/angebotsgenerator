"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabaseClient";
import { isSupabaseConfigured } from "@/lib/supabase/config";

const SUPPORTED_OTP_TYPES = new Set<EmailOtpType>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

function toEmailOtpType(value: string | null): EmailOtpType | null {
  if (!value || !SUPPORTED_OTP_TYPES.has(value as EmailOtpType)) {
    return null;
  }
  return value as EmailOtpType;
}

function sanitizeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/")) {
    return "/";
  }
  if (value.startsWith("//")) {
    return "/";
  }
  return value;
}

function formatCallbackError(rawMessage: string): string {
  const normalized = rawMessage.trim().toLowerCase();
  if (normalized.includes("expired") || normalized.includes("invalid token")) {
    return "Bestätigungslink ungültig oder abgelaufen. Bitte neuen Link anfordern.";
  }
  if (normalized.includes("invalid grant")) {
    return "Bestätigungslink konnte nicht verarbeitet werden. Bitte erneut anfordern.";
  }
  if (
    normalized.includes("could not find the table 'public.user_access'") ||
    (normalized.includes("user_access") && normalized.includes("schema cache"))
  ) {
    return "Supabase-Setup unvollständig: Tabelle user_access fehlt. Bitte Migration ausführen.";
  }
  if (normalized.includes("row-level security") || normalized.includes("permission")) {
    return "Supabase-Berechtigungen für user_access fehlen. Bitte RLS-Policies prüfen.";
  }
  return rawMessage || "Weiterleitung nach der Bestätigung konnte nicht verarbeitet werden.";
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
  return "Testzugang konnte nicht initialisiert werden.";
}

async function bootstrapTrial(): Promise<void> {
  const response = await fetch("/api/access/bootstrap", { method: "POST" });
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response));
  }
}

function AuthCallbackShell({
  status,
  error,
}: {
  status: string;
  error: string;
}) {
  return (
    <main className="authViewport authGithubViewport">
      <div className="authGithubCenter">
        <section className="authGithubCard" aria-live="polite">
          <p className="authGithubModeIntro">
            Authentifizierung
            <span>{status}</span>
          </p>

          {error ? (
            <>
              <p className="authGithubMessage authGithubMessageError">{error}</p>
              <p className="authGithubSignupHint">
                Zurück zum{" "}
                <Link href="/auth" className="authGithubInlineLink authGithubInlineLinkStrong">
                  Login
                </Link>
              </p>
            </>
          ) : (
            <p className="authGithubMessage authGithubMessageInfo">
              Bitte einen Moment warten ...
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState("Bestätigungslink wird verarbeitet ...");
  const [error, setError] = useState("");
  const authReady = isSupabaseConfigured();

  const supabase = useMemo(() => {
    if (!authReady) {
      return null;
    }
    return getSupabaseBrowserClient();
  }, [authReady]);

  const searchParamString = searchParams.toString();

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!supabase || !authReady) {
        if (!cancelled) {
          setError("Supabase ist nicht konfiguriert.");
        }
        return;
      }

      const params = new URLSearchParams(searchParamString);
      const nextPath = sanitizeNextPath(params.get("next"));
      const externalError = params.get("error_description") || params.get("error");
      const code = params.get("code");
      const tokenHash = params.get("token_hash");
      const otpType = toEmailOtpType(params.get("type"));

      try {
        if (externalError) {
          throw new Error(externalError);
        }

        if (code) {
          setStatus("Anmeldelink wird verifiziert ...");
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(
            code,
          );
          if (exchangeError) {
            throw exchangeError;
          }
        } else if (tokenHash && otpType) {
          setStatus("Token wird verifiziert ...");
          const { error: verifyError } = await supabase.auth.verifyOtp({
            type: otpType,
            token_hash: tokenHash,
          });
          if (verifyError) {
            throw verifyError;
          }
        } else {
          const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
          const accessToken = hashParams.get("access_token");
          const refreshToken = hashParams.get("refresh_token");

          if (!accessToken || !refreshToken) {
            throw new Error(
              "Bestätigungslink enthält keine verwertbaren Auth-Daten (code oder token_hash fehlt).",
            );
          }

          setStatus("Sitzung wird hergestellt ...");
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (sessionError) {
            throw sessionError;
          }
        }

        if (window.location.hash) {
          const cleanUrl = `${window.location.pathname}${window.location.search}`;
          window.history.replaceState(null, "", cleanUrl);
        }

        const { data, error: userError } = await supabase.auth.getUser();
        if (userError || !data.user) {
          throw userError ?? new Error("Keine aktive Sitzung nach Bestätigung verfügbar.");
        }

        const isRecoveryFlow = otpType === "recovery" || nextPath === "/auth/reset";
        if (!isRecoveryFlow) {
          setStatus("Testzugang wird vorbereitet ...");
          await bootstrapTrial();
        }

        const target = isRecoveryFlow ? "/auth/reset" : nextPath;
        router.replace(target);
        router.refresh();
      } catch (callbackError) {
        console.error("[auth/callback] flow failed", callbackError);
        if (!cancelled) {
          const message =
            callbackError instanceof Error
              ? callbackError.message
              : "Weiterleitung nach der Bestätigung konnte nicht verarbeitet werden.";
          setError(formatCallbackError(message));
          setStatus("Bestätigung fehlgeschlagen");
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [authReady, router, searchParamString, supabase]);

  return <AuthCallbackShell status={status} error={error} />;
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <AuthCallbackShell status="Bestätigungslink wird verarbeitet ..." error="" />
      }
    >
      <AuthCallbackContent />
    </Suspense>
  );
}
