import { NextResponse } from "next/server";
import { SupabaseClient, User } from "@supabase/supabase-js";
import {
  canUseApp,
  ensureUserAccessRecord,
  UserAccessRecord,
} from "@/lib/access/user-access";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type AuthenticatedGuardSuccess = {
  ok: true;
  supabase: SupabaseClient;
  user: User;
};

type AppAccessGuardSuccess = {
  ok: true;
  supabase: SupabaseClient;
  user: User;
  access: UserAccessRecord;
};

type GuardFailure = {
  ok: false;
  response: NextResponse;
};

export async function requireAuthenticatedUser(): Promise<
  AuthenticatedGuardSuccess | GuardFailure
> {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            "Auth ist noch nicht konfiguriert. Bitte Supabase ENV-Variablen setzen.",
        },
        { status: 500 },
      ),
    };
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Nicht eingeloggt." }, { status: 401 }),
    };
  }

  return {
    ok: true,
    supabase,
    user: data.user,
  };
}

export async function requireAppAccess(): Promise<
  AppAccessGuardSuccess | GuardFailure
> {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult;
  }

  let accessRecord: UserAccessRecord;
  try {
    accessRecord = await ensureUserAccessRecord(
      authResult.supabase,
      authResult.user,
    );
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Zugriff konnte nicht geprüft werden." },
        { status: 500 },
      ),
    };
  }

  if (!canUseApp(accessRecord)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            "Ihr kostenloser Testmonat ist beendet. Bitte schließen Sie aktiv ein Abo ab.",
        },
        { status: 402 },
      ),
    };
  }

  return {
    ok: true,
    supabase: authResult.supabase,
    user: authResult.user,
    access: accessRecord,
  };
}
