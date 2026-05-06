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

  const userId = accessResult.user.id;
  const connection = await readEmailConnection(userId);
  let providerRevoked = false;
  let revokeWarning = "";

  if (connection) {
    try {
      await revokeEmailProviderTokens(userId, connection);
      providerRevoked = true;
    } catch (error) {
      revokeWarning =
        error instanceof Error
          ? error.message
          : "Provider-Revocation fehlgeschlagen.";
    }
  }

  await clearEmailConnection(userId);
  return NextResponse.json({
    ok: true,
    providerRevoked,
    revokeWarning: revokeWarning || undefined,
  });
}
