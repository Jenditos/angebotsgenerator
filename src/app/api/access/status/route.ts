import { NextResponse } from "next/server";
import { buildAccessState, ensureUserAccessRecord } from "@/lib/access/user-access";
import { requireAuthenticatedUser } from "@/lib/access/guards";

export async function GET() {
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
  } catch {
    return NextResponse.json(
      { error: "Zugriffsstatus konnte nicht geladen werden." },
      { status: 500 },
    );
  }
}
