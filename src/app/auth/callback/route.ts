import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { ensureUserAccessRecord } from "@/lib/access/user-access";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
    return "Bestaetigungslink ungueltig oder abgelaufen. Bitte neuen Link anfordern.";
  }
  if (normalized.includes("invalid grant")) {
    return "Bestaetigungslink konnte nicht verarbeitet werden. Bitte erneut anfordern.";
  }
  if (
    normalized.includes("could not find the table 'public.user_access'") ||
    (normalized.includes("user_access") && normalized.includes("schema cache"))
  ) {
    return "Supabase-Setup unvollstaendig: Tabelle user_access fehlt. Bitte Migration ausfuehren.";
  }
  if (normalized.includes("row-level security") || normalized.includes("permission")) {
    return "Supabase-Berechtigungen fuer user_access fehlen. Bitte RLS-Policies pruefen.";
  }
  return rawMessage || "Weiterleitung nach der Bestaetigung konnte nicht verarbeitet werden.";
}

function redirectTo(
  request: NextRequest,
  pathname: string,
  query?: Record<string, string>,
): NextResponse {
  const target = request.nextUrl.clone();
  target.pathname = pathname;
  target.search = "";

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      target.searchParams.set(key, value);
    }
  }

  return NextResponse.redirect(target);
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return redirectTo(request, "/auth/callback/error", {
      message: "Supabase ist nicht konfiguriert.",
    });
  }

  const params = request.nextUrl.searchParams;
  const nextPath = sanitizeNextPath(params.get("next"));
  const externalError = params.get("error_description") || params.get("error");
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const otpType = toEmailOtpType(params.get("type"));

  try {
    if (externalError) {
      throw new Error(externalError);
    }

    const supabase = createSupabaseServerClient();

    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        throw error;
      }
    } else if (tokenHash && otpType) {
      const { error } = await supabase.auth.verifyOtp({
        type: otpType,
        token_hash: tokenHash,
      });
      if (error) {
        throw error;
      }
    } else {
      throw new Error(
        "Bestaetigungslink enthaelt keine verwertbaren Auth-Daten (code oder token_hash&type fehlt).",
      );
    }

    const { data, error: userError } = await supabase.auth.getUser();
    if (userError || !data.user) {
      throw userError ?? new Error("Keine aktive Sitzung nach Bestaetigung verfuegbar.");
    }

    const isRecoveryFlow = otpType === "recovery" || nextPath === "/auth/reset";
    if (!isRecoveryFlow) {
      await ensureUserAccessRecord(supabase, data.user);
    }

    const target = isRecoveryFlow ? "/auth/reset" : nextPath;
    return redirectTo(request, target);
  } catch (error) {
    console.error("[auth/callback] flow failed", error);
    const message =
      error instanceof Error
        ? formatCallbackError(error.message)
        : "Weiterleitung nach der Bestaetigung konnte nicht verarbeitet werden.";

    return redirectTo(request, "/auth/callback/error", { message });
  }
}
