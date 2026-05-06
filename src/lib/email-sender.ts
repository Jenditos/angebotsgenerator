import { ensureFreshEmailConnection } from "@/lib/email-oauth";
import { readEmailConnection } from "@/lib/email-store";
import {
  EmailConnection,
  EmailDraftPayload,
  EmailDraftResult,
  EmailSendPayload,
  EmailSendResult,
} from "@/types/email";

function foldBase64(input: string, lineLength = 76): string {
  const chunks: string[] = [];
  for (let i = 0; i < input.length; i += lineLength) {
    chunks.push(input.slice(i, i + lineLength));
  }
  return chunks.join("\r\n");
}

function buildMimeMessage(payload: EmailSendPayload): string {
  const boundary = `visioro-${Date.now()}`;
  const filename = payload.filename || "angebot.pdf";

  return [
    `To: ${payload.to}`,
    `Subject: ${payload.subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary=\"${boundary}\"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=\"UTF-8\"",
    "Content-Transfer-Encoding: 7bit",
    "",
    payload.text,
    "",
    `--${boundary}`,
    `Content-Type: application/pdf; name=\"${filename}\"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename=\"${filename}\"`,
    "",
    foldBase64(payload.pdfBase64),
    `--${boundary}--`
  ].join("\r\n");
}

function toGoogleRawMime(payload: EmailSendPayload): string {
  return Buffer.from(buildMimeMessage(payload), "utf-8").toString("base64url");
}

async function sendWithGoogle(connection: EmailConnection, payload: EmailSendPayload): Promise<void> {
  const raw = toGoogleRawMime(payload);

  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${connection.accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ raw })
  });

  if (!response.ok) {
    throw new Error("Gmail Versand fehlgeschlagen.");
  }
}

async function createDraftWithGoogle(
  connection: EmailConnection,
  payload: EmailDraftPayload,
): Promise<{ composeUrl: string; draftId?: string }> {
  const raw = toGoogleRawMime(payload);
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${connection.accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message: { raw }
    })
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        "Gmail Berechtigung für Entwürfe fehlt. Bitte Postfach neu verbinden.",
      );
    }
    throw new Error("Gmail Entwurf konnte nicht erstellt werden.");
  }

  const data = (await response.json()) as {
    id?: string;
    message?: { id?: string };
  };
  const composeToken = data.message?.id || data.id || "";

  return {
    composeUrl: composeToken
      ? `https://mail.google.com/mail/u/0/#drafts?compose=${encodeURIComponent(composeToken)}`
      : "https://mail.google.com/mail/u/0/#drafts",
    draftId: data.id
  };
}

async function sendWithMicrosoft(connection: EmailConnection, payload: EmailSendPayload): Promise<void> {
  const filename = payload.filename || "angebot.pdf";
  const response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${connection.accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message: {
        subject: payload.subject,
        body: {
          contentType: "Text",
          content: payload.text
        },
        toRecipients: [
          {
            emailAddress: { address: payload.to }
          }
        ],
        attachments: [
          {
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: filename,
            contentType: "application/pdf",
            contentBytes: payload.pdfBase64
          }
        ]
      },
      saveToSentItems: true
    })
  });

  if (!response.ok) {
    throw new Error("Outlook Versand fehlgeschlagen.");
  }
}

async function createDraftWithMicrosoft(
  connection: EmailConnection,
  payload: EmailDraftPayload,
): Promise<{ composeUrl: string; draftId: string }> {
  const filename = payload.filename || "angebot.pdf";
  const createDraftResponse = await fetch("https://graph.microsoft.com/v1.0/me/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${connection.accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      subject: payload.subject,
      body: {
        contentType: "Text",
        content: payload.text
      },
      toRecipients: [
        {
          emailAddress: { address: payload.to }
        }
      ]
    })
  });

  if (!createDraftResponse.ok) {
    if (createDraftResponse.status === 401 || createDraftResponse.status === 403) {
      throw new Error(
        "Outlook Berechtigung für Entwürfe fehlt. Bitte Postfach neu verbinden.",
      );
    }
    throw new Error("Outlook Entwurf konnte nicht erstellt werden.");
  }

  const createdDraft = (await createDraftResponse.json()) as { id?: string };
  const draftId = createdDraft.id?.trim();
  if (!draftId) {
    throw new Error("Outlook Entwurf enthält keine ID.");
  }

  const attachmentResponse = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(draftId)}/attachments`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${connection.accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: filename,
        contentType: "application/pdf",
        contentBytes: payload.pdfBase64
      })
    },
  );

  if (!attachmentResponse.ok) {
    throw new Error("PDF-Anhang konnte dem Outlook Entwurf nicht hinzugefügt werden.");
  }

  return {
    composeUrl: `https://outlook.office.com/mail/deeplink/compose?draftId=${encodeURIComponent(draftId)}`,
    draftId
  };
}

export async function sendViaConnectedMailbox(payload: EmailSendPayload): Promise<EmailSendResult> {
  const connection = await readEmailConnection();
  if (!connection) {
    return { ok: false, reason: "not_connected", info: "Kein verbundenes Postfach gefunden." };
  }

  try {
    const fresh = await ensureFreshEmailConnection(connection);
    if (fresh.provider === "google") {
      await sendWithGoogle(fresh, payload);
      return {
        ok: true,
        info: `E-Mail über Gmail gesendet (${fresh.accountEmail}).`,
        provider: "google",
        accountEmail: fresh.accountEmail,
      };
    }
    await sendWithMicrosoft(fresh, payload);
    return {
      ok: true,
      info: `E-Mail über Outlook gesendet (${fresh.accountEmail}).`,
      provider: "microsoft",
      accountEmail: fresh.accountEmail,
    };
  } catch (error) {
    return {
      ok: false,
      reason: "failed",
      info: error instanceof Error ? error.message : "Versand über verbundenes Postfach fehlgeschlagen."
    };
  }
}

export async function createDraftViaConnectedMailbox(
  payload: EmailDraftPayload,
): Promise<EmailDraftResult> {
  const connection = await readEmailConnection();
  if (!connection) {
    return {
      ok: false,
      reason: "not_connected",
      info: "Kein verbundenes Postfach gefunden."
    };
  }

  try {
    const fresh = await ensureFreshEmailConnection(connection);
    if (fresh.provider === "google") {
      const draft = await createDraftWithGoogle(fresh, payload);
      return {
        ok: true,
        info: `Gmail Entwurf erstellt (${fresh.accountEmail}).`,
        composeUrl: draft.composeUrl,
        draftId: draft.draftId,
        provider: "google",
        accountEmail: fresh.accountEmail,
      };
    }

    const draft = await createDraftWithMicrosoft(fresh, payload);
    return {
      ok: true,
      info: `Outlook Entwurf erstellt (${fresh.accountEmail}).`,
      composeUrl: draft.composeUrl,
      draftId: draft.draftId,
      provider: "microsoft",
      accountEmail: fresh.accountEmail,
    };
  } catch (error) {
    return {
      ok: false,
      reason: "failed",
      info:
        error instanceof Error
          ? error.message
          : "Entwurf über verbundenes Postfach fehlgeschlagen."
    };
  }
}
