import { NextResponse } from "next/server";
import { getEmailConnectUrl } from "@/lib/email-oauth";
import { EmailProvider } from "@/types/email";

function isProvider(value: string | null): value is EmailProvider {
  return value === "google" || value === "microsoft";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const providerRaw = url.searchParams.get("provider");
  const returnTo = url.searchParams.get("returnTo") || "/";

  if (!isProvider(providerRaw)) {
    return NextResponse.redirect(new URL("/?mail_connected=0&reason=Ungültiger%20Provider", request.url));
  }

  try {
    const authUrl = getEmailConnectUrl(providerRaw, request, returnTo);
    return NextResponse.redirect(authUrl);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Verbindung konnte nicht gestartet werden.";
    const fallback = new URL(returnTo.startsWith("/") ? returnTo : "/", request.url);
    fallback.searchParams.set("mail_connected", "0");
    fallback.searchParams.set("reason", reason);
    return NextResponse.redirect(fallback);
  }
}
