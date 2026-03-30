import { NextResponse } from "next/server";
import { requireAppAccess } from "@/lib/access/guards";
import {
  revokeEmailProviderTokens,
} from "@/lib/email-oauth";
import { clearEmailConnection, readEmailConnection } from "@/lib/email-store";

export async function POST() {
  const accessResult = await requireAppAccess();
  if (!accessResult.ok) {
    return accessResult.response;
  }

  const connection = await readEmailConnection();
  let providerRevoked = false;
  let revokeWarning = "";

  if (connection) {
    try {
      await revokeEmailProviderTokens(connection);
      providerRevoked = true;
    } catch (error) {
      revokeWarning =
        error instanceof Error
          ? error.message
          : "Provider-Revocation fehlgeschlagen.";
    }
  }

  await clearEmailConnection();
  return NextResponse.json({
    ok: true,
    providerRevoked,
    revokeWarning: revokeWarning || undefined,
  });
}
