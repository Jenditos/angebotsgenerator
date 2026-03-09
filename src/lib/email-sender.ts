import { ensureFreshEmailConnection } from "@/lib/email-oauth";
import { readEmailConnection } from "@/lib/email-store";
import { EmailConnection, EmailSendPayload, EmailSendResult } from "@/types/email";

function foldBase64(input: string, lineLength = 76): string {
  const chunks: string[] = [];
  for (let i = 0; i < input.length; i += lineLength) {
    chunks.push(input.slice(i, i + lineLength));
  }
  return chunks.join("\r\n");
}

async function sendWithGoogle(connection: EmailConnection, payload: EmailSendPayload): Promise<void> {
  const boundary = `visioro-${Date.now()}`;
  const filename = payload.filename || "angebot.pdf";

  const mime = [
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

  const raw = Buffer.from(mime, "utf-8").toString("base64url");

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

export async function sendViaConnectedMailbox(payload: EmailSendPayload): Promise<EmailSendResult> {
  const connection = await readEmailConnection();
  if (!connection) {
    return { ok: false, reason: "not_connected", info: "Kein verbundenes Postfach gefunden." };
  }

  try {
    const fresh = await ensureFreshEmailConnection(connection);
    if (fresh.provider === "google") {
      await sendWithGoogle(fresh, payload);
      return { ok: true, info: `E-Mail über Gmail gesendet (${fresh.accountEmail}).` };
    }
    await sendWithMicrosoft(fresh, payload);
    return { ok: true, info: `E-Mail über Outlook gesendet (${fresh.accountEmail}).` };
  } catch (error) {
    return {
      ok: false,
      reason: "failed",
      info: error instanceof Error ? error.message : "Versand über verbundenes Postfach fehlgeschlagen."
    };
  }
}
