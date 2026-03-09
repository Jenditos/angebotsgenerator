import { NextResponse } from "next/server";
import { handleEmailCallback } from "@/lib/email-oauth";

export async function GET(request: Request) {
  const path = await handleEmailCallback(request);
  return NextResponse.redirect(new URL(path, request.url));
}

