import { NextResponse } from "next/server";
import { clearEmailConnection } from "@/lib/email-store";

export async function POST() {
  await clearEmailConnection();
  return NextResponse.json({ ok: true });
}

