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

export type EmailSendResult =
  | { ok: true; info: string }
  | { ok: false; reason: "not_connected" | "failed"; info: string };

