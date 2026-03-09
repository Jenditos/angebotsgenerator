import { createHmac, randomUUID } from "node:crypto";
import { readEmailConnection, writeEmailConnection } from "@/lib/email-store";
import { EmailConnection, EmailProvider } from "@/types/email";

type StatePayload = {
  provider: EmailProvider;
  returnTo: string;
  ts: number;
  nonce: string;
};

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token?: string;
};

export function getEmailProviderAvailability() {
  return {
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    microsoft: Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET)
  };
}

function getAppBaseUrl(request?: Request): string {
  const envUrl = process.env.APP_URL?.trim();
  if (envUrl) {
    return envUrl.replace(/\/+$/, "");
  }
  if (request) {
    return new URL(request.url).origin;
  }
  return "http://localhost:3000";
}

function getStateSecret(): string {
  return process.env.OAUTH_STATE_SECRET || "visioro-dev-oauth-state-secret";
}

function safeReturnPath(returnTo?: string | null): string {
  if (!returnTo) {
    return "/";
  }
  return returnTo.startsWith("/") ? returnTo : "/";
}

function signState(payloadBase64: string): string {
  return createHmac("sha256", getStateSecret()).update(payloadBase64).digest("base64url");
}

function createSignedState(payload: StatePayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  return `${encoded}.${signState(encoded)}`;
}

function verifySignedState(rawState: string): StatePayload {
  const [encoded, signature] = rawState.split(".");
  if (!encoded || !signature) {
    throw new Error("Ungültiger State.");
  }
  const expected = signState(encoded);
  if (expected !== signature) {
    throw new Error("State-Signatur ungültig.");
  }
  const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8")) as StatePayload;
  if (!parsed.provider || !parsed.returnTo || !parsed.ts) {
    throw new Error("State-Payload unvollständig.");
  }
  if (Date.now() - parsed.ts > 15 * 60 * 1000) {
    throw new Error("State abgelaufen.");
  }
  return parsed;
}

function getGoogleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth ist nicht konfiguriert.");
  }
  return { clientId, clientSecret };
}

function getMicrosoftConfig() {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Microsoft OAuth ist nicht konfiguriert.");
  }
  const tenant = process.env.MICROSOFT_TENANT_ID || "common";
  return { clientId, clientSecret, tenant };
}

function getCallbackUrl(request?: Request): string {
  return `${getAppBaseUrl(request)}/api/email/callback`;
}

export function getEmailConnectUrl(provider: EmailProvider, request: Request, returnTo?: string | null): string {
  const redirectUri = getCallbackUrl(request);
  const state = createSignedState({
    provider,
    returnTo: safeReturnPath(returnTo),
    ts: Date.now(),
    nonce: randomUUID()
  });

  if (provider === "google") {
    const { clientId } = getGoogleConfig();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email https://www.googleapis.com/auth/gmail.send",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  const { clientId, tenant } = getMicrosoftConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    response_mode: "query",
    scope: "offline_access Mail.Send User.Read",
    state
  });
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${params.toString()}`;
}

function withReturnQuery(path: string, params: Record<string, string>): string {
  const url = new URL(path, "http://localhost");
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return `${url.pathname}${url.search}`;
}

async function exchangeGoogleCode(code: string, redirectUri: string): Promise<TokenResponse> {
  const { clientId, clientSecret } = getGoogleConfig();
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code"
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!response.ok) {
    throw new Error("Google Token-Exchange fehlgeschlagen.");
  }
  return (await response.json()) as TokenResponse;
}

async function exchangeMicrosoftCode(code: string, redirectUri: string): Promise<TokenResponse> {
  const { clientId, clientSecret, tenant } = getMicrosoftConfig();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    scope: "offline_access Mail.Send User.Read"
  });
  const response = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!response.ok) {
    throw new Error("Microsoft Token-Exchange fehlgeschlagen.");
  }
  return (await response.json()) as TokenResponse;
}

function decodeJwtEmail(idToken?: string): string {
  if (!idToken) {
    return "";
  }
  try {
    const payload = idToken.split(".")[1];
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as { email?: string };
    return parsed.email ?? "";
  } catch {
    return "";
  }
}

async function fetchGoogleAccountEmail(accessToken: string, idToken?: string): Promise<string> {
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (response.ok) {
    const data = (await response.json()) as { emailAddress?: string };
    if (data.emailAddress) {
      return data.emailAddress;
    }
  }
  const decoded = decodeJwtEmail(idToken);
  if (decoded) {
    return decoded;
  }
  throw new Error("Google Account-E-Mail konnte nicht gelesen werden.");
}

async function fetchMicrosoftAccountEmail(accessToken: string): Promise<string> {
  const response = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    throw new Error("Microsoft Konto konnte nicht gelesen werden.");
  }
  const data = (await response.json()) as { mail?: string; userPrincipalName?: string };
  const email = data.mail || data.userPrincipalName;
  if (!email) {
    throw new Error("Microsoft E-Mail fehlt im Profil.");
  }
  return email;
}

export async function handleEmailCallback(request: Request): Promise<string> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const rawState = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description") || "";

  if (!rawState) {
    return withReturnQuery("/", { mail_connected: "0", reason: "State fehlt." });
  }

  let state: StatePayload;
  try {
    state = verifySignedState(rawState);
  } catch (stateError) {
    return withReturnQuery("/", { mail_connected: "0", reason: String(stateError) });
  }

  if (error) {
    return withReturnQuery(state.returnTo, {
      mail_connected: "0",
      reason: `${error}${errorDescription ? `: ${errorDescription}` : ""}`
    });
  }

  if (!code) {
    return withReturnQuery(state.returnTo, { mail_connected: "0", reason: "OAuth Code fehlt." });
  }

  try {
    const redirectUri = getCallbackUrl(request);
    const token =
      state.provider === "google"
        ? await exchangeGoogleCode(code, redirectUri)
        : await exchangeMicrosoftCode(code, redirectUri);

    const existing = await readEmailConnection();
    const refreshToken =
      token.refresh_token || (existing?.provider === state.provider ? existing.refreshToken : "");
    if (!refreshToken) {
      throw new Error("Refresh Token fehlt. Bitte Verbindung erneut herstellen.");
    }

    const accountEmail =
      state.provider === "google"
        ? await fetchGoogleAccountEmail(token.access_token, token.id_token)
        : await fetchMicrosoftAccountEmail(token.access_token);

    const connection: EmailConnection = {
      provider: state.provider,
      accountEmail,
      accessToken: token.access_token,
      refreshToken,
      expiresAt: Date.now() + token.expires_in * 1000
    };
    await writeEmailConnection(connection);

    return withReturnQuery(state.returnTo, { mail_connected: "1", provider: state.provider });
  } catch (callbackError) {
    return withReturnQuery(state.returnTo, {
      mail_connected: "0",
      reason: callbackError instanceof Error ? callbackError.message : "Verbindung fehlgeschlagen."
    });
  }
}

async function refreshGoogle(connection: EmailConnection): Promise<EmailConnection> {
  const { clientId, clientSecret } = getGoogleConfig();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: connection.refreshToken
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!response.ok) {
    throw new Error("Google Token-Refresh fehlgeschlagen.");
  }
  const data = (await response.json()) as TokenResponse;
  return {
    ...connection,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || connection.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000
  };
}

async function refreshMicrosoft(connection: EmailConnection): Promise<EmailConnection> {
  const { clientId, clientSecret, tenant } = getMicrosoftConfig();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: connection.refreshToken,
    scope: "offline_access Mail.Send User.Read"
  });
  const response = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!response.ok) {
    throw new Error("Microsoft Token-Refresh fehlgeschlagen.");
  }
  const data = (await response.json()) as TokenResponse;
  return {
    ...connection,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || connection.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000
  };
}

export async function ensureFreshEmailConnection(connection: EmailConnection): Promise<EmailConnection> {
  if (Date.now() < connection.expiresAt - 60_000) {
    return connection;
  }
  const refreshed = connection.provider === "google" ? await refreshGoogle(connection) : await refreshMicrosoft(connection);
  await writeEmailConnection(refreshed);
  return refreshed;
}
