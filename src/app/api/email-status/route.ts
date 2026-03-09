import { NextResponse } from "next/server";
import { getEmailProviderAvailability } from "@/lib/email-oauth";
import { readEmailConnection } from "@/lib/email-store";

export async function GET() {
  const connection = await readEmailConnection();
  const providers = getEmailProviderAvailability();
  const resendConfigured = Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);

  return NextResponse.json({
    connected: Boolean(connection),
    provider: connection?.provider ?? null,
    accountEmail: connection?.accountEmail ?? null,
    providers,
    resendConfigured,
    directSendReady: Boolean(connection) || resendConfigured
  });
}

