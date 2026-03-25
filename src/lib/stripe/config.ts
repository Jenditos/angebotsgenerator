export const MONTHLY_PRICE_CENTS = 4990;
export const MONTHLY_PRICE_LABEL = "49,90 EUR / Monat";
export const STRIPE_MONTHLY_PRICE_ID = process.env.STRIPE_MONTHLY_PRICE_ID ?? "";
export const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "";
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";

export function isStripeConfigured(): boolean {
  return Boolean(STRIPE_SECRET_KEY);
}

export function isStripeWebhookConfigured(): boolean {
  return Boolean(STRIPE_SECRET_KEY && STRIPE_WEBHOOK_SECRET);
}

export function resolveAppBaseUrl(request: Request): string {
  const envBase = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim();
  if (envBase) {
    return envBase.replace(/\/+$/, "");
  }

  return new URL(request.url).origin;
}
