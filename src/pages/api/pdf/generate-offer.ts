import type { NextApiRequest, NextApiResponse } from "next";
import { handleGenerateOfferAuthorizedRequest } from "@/app/api/generate-offer/route";
import { isAuthBypassEnabled } from "@/lib/access/auth-bypass";
import {
  classifyUserAccessError,
  isUserAccessSetupError,
  logUserAccessError,
} from "@/lib/access/access-errors";
import {
  canUseApp,
  ensureUserAccessRecord,
} from "@/lib/access/user-access";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabasePagesServerClient } from "@/lib/supabase/pages";
import {
  buildWebRequestFromApiRequest,
  sendWebResponseToApiResponse,
} from "@/server/pages-api-bridge";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "12mb",
    },
  },
};

async function requirePagesApiAppAccess(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (isAuthBypassEnabled()) {
    return { ok: true };
  }

  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      status: 500,
      error:
        "Auth ist noch nicht konfiguriert. Bitte Supabase ENV-Variablen setzen.",
    };
  }

  const supabase = createSupabasePagesServerClient(req, res);
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return {
      ok: false,
      status: 401,
      error: "Nicht eingeloggt.",
    };
  }

  try {
    const accessRecord = await ensureUserAccessRecord(supabase, data.user);
    if (!canUseApp(accessRecord)) {
      return {
        ok: false,
        status: 402,
        error:
          "Ihr kostenloser Testmonat ist beendet. Bitte schließen Sie aktiv ein Abo ab.",
      };
    }

    return { ok: true };
  } catch (accessError) {
    if (isUserAccessSetupError(accessError)) {
      logUserAccessError("pages/api/pdf/generate-offer transient setup fallback", accessError, {
        userId: data.user.id,
      });
      return { ok: true };
    }

    logUserAccessError("pages/api/pdf/generate-offer", accessError, {
      userId: data.user.id,
    });
    const classifiedError = classifyUserAccessError(
      accessError,
      "Zugriff konnte aktuell nicht geprüft werden. Bitte später erneut versuchen.",
    );
    return {
      ok: false,
      status: classifiedError.status,
      error: classifiedError.publicMessage,
    };
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const accessResult = await requirePagesApiAppAccess(req, res);
  if (!accessResult.ok) {
    res.status(accessResult.status).json({ error: accessResult.error });
    return;
  }

  let response: Response;
  try {
    response = await handleGenerateOfferAuthorizedRequest(
      buildWebRequestFromApiRequest(req, "http://localhost:3003/api/generate-offer"),
    );
  } catch (error) {
    console.error("[pages/api/pdf/generate-offer] unexpected failure", error);
    res.status(500).json({
      error:
        "Die PDF-Erstellung ist fehlgeschlagen. Bitte versuchen Sie es erneut.",
    });
    return;
  }

  await sendWebResponseToApiResponse(response, res);
}
