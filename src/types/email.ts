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
};

export type EmailDraftPayload = EmailSendPayload;

export type EmailSendResult =
  | { ok: true; info: string }
  | { ok: false; reason: "not_connected" | "failed"; info: string };

export type EmailDraftResult =
  | { ok: true; info: string; composeUrl: string; draftId?: string }
  | { ok: false; reason: "not_connected" | "failed"; info: string };
