import { NextResponse } from "next/server";
import {
  buildBypassAccessRecord,
  isAuthBypassEnabled,
} from "@/lib/access/auth-bypass";
import {
  classifyUserAccessError,
  logUserAccessError,
} from "@/lib/access/access-errors";
import { buildAccessState, ensureUserAccessRecord } from "@/lib/access/user-access";
import { requireAuthenticatedUser } from "@/lib/access/guards";

export async function POST() {
  if (isAuthBypassEnabled()) {
    const accessRecord = buildBypassAccessRecord();
    return NextResponse.json({
      access: accessRecord,
      state: buildAccessState(accessRecord),
    });
  }

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
    logUserAccessError("POST /api/access/bootstrap", error, {
      userId: authResult.user.id,
    });
    const classifiedError = classifyUserAccessError(
      error,
      "Testzugang konnte nicht initialisiert werden.",
    );
    return NextResponse.json(
      { error: classifiedError.publicMessage },
      { status: classifiedError.status },
    );
  }
}
