import { NextResponse } from "next/server";
import { buildAccessState, ensureUserAccessRecord } from "@/lib/access/user-access";
import { requireAuthenticatedUser } from "@/lib/access/guards";

type SupabaseErrorLike = {
  message?: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
};

function asSupabaseError(error: unknown): SupabaseErrorLike {
  if (!error || typeof error !== "object") {
    return {};
  }
  return error as SupabaseErrorLike;
}

function toBootstrapErrorMessage(error: unknown): string {
  const supabaseError = asSupabaseError(error);
  const code = (supabaseError.code ?? "").trim();
  const message = (supabaseError.message ?? "").toLowerCase();

  if (
    code === "42P01" ||
    message.includes("could not find the table 'public.user_access'") ||
    (message.includes("user_access") && message.includes("schema cache"))
  ) {
    return "Testzugang-Setup fehlt: Supabase-Tabelle user_access ist nicht vorhanden. Bitte Migration ausführen.";
  }

  if (code === "42501" || message.includes("row-level security")) {
    return "Testzugang kann nicht initialisiert werden: RLS-Policies für user_access fehlen oder sind fehlerhaft.";
  }

  return "Testzugang konnte nicht initialisiert werden.";
}

export async function POST() {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  try {
    const accessRecord = await ensureUserAccessRecord(
      authResult.supabase,
      authResult.user,
    );

    return NextResponse.json({
      access: accessRecord,
      state: buildAccessState(accessRecord),
    });
  } catch (error) {
    const supabaseError = asSupabaseError(error);
    console.error("[api/access/bootstrap] failed", {
      userId: authResult.user.id,
      code: supabaseError.code ?? null,
      message: supabaseError.message ?? String(error),
      details: supabaseError.details ?? null,
      hint: supabaseError.hint ?? null,
    });

    return NextResponse.json(
      { error: toBootstrapErrorMessage(error) },
      { status: 500 },
    );
  }
}
