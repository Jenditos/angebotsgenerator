import type { StoredEmailProvider } from "@/types/offer";

export type EmailProvider = "google" | "microsoft";

export type EmailConnection = {
  provider: EmailProvider;
  accountEmail: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

export type EmailSendPayload = {
  to: string;
  subject: string;
  text: string;
  pdfBase64: string;
  filename?: string;
  documentNumber?: string;
  documentType?: "offer" | "invoice";
  idempotencyKey?: string;
};

export type EmailDraftPayload = EmailSendPayload;

export type EmailSendResult =
  | { ok: true; info: string; provider?: StoredEmailProvider; accountEmail?: string }
  | { ok: false; reason: "not_connected" | "failed"; info: string };

export type EmailDraftResult =
  | {
      ok: true;
      info: string;
      composeUrl: string;
      draftId?: string;
      provider?: StoredEmailProvider;
      accountEmail?: string;
    }
  | { ok: false; reason: "not_connected" | "failed"; info: string };
