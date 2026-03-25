import { NextResponse } from "next/server";
import { requireAppAccess } from "@/lib/access/guards";
import { clearEmailConnection } from "@/lib/email-store";

export async function POST() {
  const accessResult = await requireAppAccess();
  if (!accessResult.ok) {
    return accessResult.response;
  }

  await clearEmailConnection();
  return NextResponse.json({ ok: true });
}
