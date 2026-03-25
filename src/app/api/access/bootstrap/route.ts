import { NextResponse } from "next/server";
import { buildAccessState, ensureUserAccessRecord } from "@/lib/access/user-access";
import { requireAuthenticatedUser } from "@/lib/access/guards";

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
  } catch {
    return NextResponse.json(
      { error: "Testzugang konnte nicht initialisiert werden." },
      { status: 500 },
    );
  }
}
