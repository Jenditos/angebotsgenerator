import { NextResponse } from "next/server";
import {
  buildBypassAccessRecord,
  buildBypassUser,
  isAuthBypassEnabled,
} from "@/lib/access/auth-bypass";
import {
  classifyUserAccessError,
  logUserAccessError,
} from "@/lib/access/access-errors";
import { buildAccessState, ensureUserAccessRecord } from "@/lib/access/user-access";
import { requireAuthenticatedUser } from "@/lib/access/guards";

export async function GET() {
  if (isAuthBypassEnabled()) {
    const user = buildBypassUser();
    const accessRecord = buildBypassAccessRecord();
    return NextResponse.json({
      authenticated: true,
      user: {
        id: user.id,
        email: user.email ?? "",
      },
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
      authenticated: true,
      user: {
        id: authResult.user.id,
        email: authResult.user.email ?? "",
      },
      access: accessRecord,
      state: buildAccessState(accessRecord),
    });
  } catch (error) {
    logUserAccessError("GET /api/access/status", error, {
      userId: authResult.user.id,
    });
    const classifiedError = classifyUserAccessError(
      error,
      "Zugriffsstatus konnte nicht geladen werden.",
    );
    return NextResponse.json(
      { error: classifiedError.publicMessage },
      { status: classifiedError.status },
    );
  }
}
