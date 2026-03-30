import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { readEmailConnection, writeEmailConnection } from "@/lib/email-store";
import { EmailConnection, EmailProvider } from "@/types/email";

const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;
const OAUTH_PKCE_COOKIE_PREFIX = "visioro-oauth-pkce-";

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

export type EmailConnectStart = {
  authUrl: string;
  pkceCookie: {
    name: string;
    value: string;
    maxAge: number;
    secure: boolean;
    sameSite: "lax";
    path: "/";
    httpOnly: true;
  };
};

export type EmailCallbackResult = {
  redirectPath: string;
  clearCookieName?: string;
};

export function assertEmailOAuthSecretConfigured(): void {
  getStateSecret();
}

function hasStateSecret(): boolean {
  return Boolean(process.env.EMAIL_OAUTH_SECRET?.trim());
}

export function getEmailProviderAvailability() {
  return {
    google: Boolean(
      process.env.GOOGLE_CLIENT_ID &&
        process.env.GOOGLE_CLIENT_SECRET &&
        hasStateSecret(),
    ),
    microsoft: Boolean(
      process.env.MICROSOFT_CLIENT_ID &&
        process.env.MICROSOFT_CLIENT_SECRET &&
        hasStateSecret(),
    ),
  };
}

function getAppBaseUrl(request?: Request): string {
  const envUrl =
    process.env.APP_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (envUrl) {
    return envUrl.replace(/\/+$/, "");
  }
  if (request) {
    return new URL(request.url).origin;
  }
  return "http://localhost:3000";
}

function getStateSecret(): string {
  const secret = process.env.EMAIL_OAUTH_SECRET?.trim();
  if (!secret) {
    throw new Error("EMAIL_OAUTH_SECRET ist nicht gesetzt.");
  }
  return secret;
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
  const expectedBuffer = Buffer.from(expected, "utf-8");
  const signatureBuffer = Buffer.from(signature, "utf-8");
  if (
    expectedBuffer.length !== signatureBuffer.length ||
    !timingSafeEqual(expectedBuffer, signatureBuffer)
  ) {
    throw new Error("State-Signatur ungültig.");
  }
  const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8")) as StatePayload;
  if (!parsed.provider || !parsed.returnTo || !parsed.ts) {
    throw new Error("State-Payload unvollständig.");
  }
  if (Date.now() - parsed.ts > OAUTH_STATE_TTL_MS) {
    throw new Error("State abgelaufen.");
  }
  return parsed;
}

function createPkceVerifier(): string {
  return randomBytes(48).toString("base64url");
}

function createPkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function getPkceCookieName(nonce: string): string {
  return `${OAUTH_PKCE_COOKIE_PREFIX}${nonce}`;
}

function readCookieValue(request: Request, name: string): string {
  const rawCookieHeader = request.headers.get("cookie");
  if (!rawCookieHeader) {
    return "";
  }

  for (const entry of rawCookieHeader.split(";")) {
    const [rawName, ...rawValueParts] = entry.trim().split("=");
    if (rawName !== name) {
      continue;
    }

    return decodeURIComponent(rawValueParts.join("="));
  }

  return "";
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

export function startEmailConnect(
  provider: EmailProvider,
  request: Request,
  returnTo?: string | null,
): EmailConnectStart {
  const redirectUri = getCallbackUrl(request);
  const nonce = randomUUID();
  const codeVerifier = createPkceVerifier();
  const codeChallenge = createPkceChallenge(codeVerifier);
  const state = createSignedState({
    provider,
    returnTo: safeReturnPath(returnTo),
    ts: Date.now(),
    nonce,
  });

  let authUrl = "";
  if (provider === "google") {
    const { clientId } = getGoogleConfig();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope:
        "openid email https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.compose",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
    authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  } else {
    const { clientId, tenant } = getMicrosoftConfig();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      response_mode: "query",
      scope: "offline_access Mail.Send Mail.ReadWrite User.Read",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
    authUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${params.toString()}`;
  }

  return {
    authUrl,
    pkceCookie: {
      name: getPkceCookieName(nonce),
      value: codeVerifier,
      maxAge: Math.floor(OAUTH_STATE_TTL_MS / 1000),
      secure: redirectUri.startsWith("https://"),
      sameSite: "lax",
      path: "/",
      httpOnly: true,
    },
  };
}

function withReturnQuery(path: string, params: Record<string, string>): string {
  const url = new URL(path, "http://localhost");
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return `${url.pathname}${url.search}`;
}

async function exchangeGoogleCode(
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<TokenResponse> {
  const { clientId, clientSecret } = getGoogleConfig();
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code_verifier: codeVerifier,
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

async function exchangeMicrosoftCode(
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<TokenResponse> {
  const { clientId, clientSecret, tenant } = getMicrosoftConfig();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    scope: "offline_access Mail.Send Mail.ReadWrite User.Read",
    code_verifier: codeVerifier,
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

async function fetchGoogleAccountEmail(accessToken: string): Promise<string> {
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (response.ok) {
    const data = (await response.json()) as { emailAddress?: string };
    if (data.emailAddress) {
      return data.emailAddress;
    }
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

export async function handleEmailCallback(
  request: Request,
): Promise<EmailCallbackResult> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const rawState = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description") || "";

  if (!rawState) {
    return {
      redirectPath: withReturnQuery("/", {
        mail_connected: "0",
        reason: "State fehlt.",
      }),
    };
  }

  let state: StatePayload;
  try {
    state = verifySignedState(rawState);
  } catch (stateError) {
    return {
      redirectPath: withReturnQuery("/", {
        mail_connected: "0",
        reason: String(stateError),
      }),
    };
  }
  const pkceCookieName = getPkceCookieName(state.nonce);
  const codeVerifier = readCookieValue(request, pkceCookieName);

  if (error) {
    return {
      redirectPath: withReturnQuery(state.returnTo, {
        mail_connected: "0",
        reason: `${error}${errorDescription ? `: ${errorDescription}` : ""}`,
      }),
      clearCookieName: pkceCookieName,
    };
  }

  if (!code) {
    return {
      redirectPath: withReturnQuery(state.returnTo, {
        mail_connected: "0",
        reason: "OAuth Code fehlt.",
      }),
      clearCookieName: pkceCookieName,
    };
  }

  if (!codeVerifier) {
    return {
      redirectPath: withReturnQuery(state.returnTo, {
        mail_connected: "0",
        reason: "PKCE-Verifier fehlt oder ist abgelaufen.",
      }),
      clearCookieName: pkceCookieName,
    };
  }

  try {
    const redirectUri = getCallbackUrl(request);
    const token =
      state.provider === "google"
        ? await exchangeGoogleCode(code, redirectUri, codeVerifier)
        : await exchangeMicrosoftCode(code, redirectUri, codeVerifier);

    const existing = await readEmailConnection();
    const refreshToken =
      token.refresh_token || (existing?.provider === state.provider ? existing.refreshToken : "");
    if (!refreshToken) {
      throw new Error("Refresh Token fehlt. Bitte Verbindung erneut herstellen.");
    }

    const accountEmail =
      state.provider === "google"
        ? await fetchGoogleAccountEmail(token.access_token)
        : await fetchMicrosoftAccountEmail(token.access_token);

    const connection: EmailConnection = {
      provider: state.provider,
      accountEmail,
      accessToken: token.access_token,
      refreshToken,
      expiresAt: Date.now() + token.expires_in * 1000
    };
    await writeEmailConnection(connection);

    return {
      redirectPath: withReturnQuery(state.returnTo, {
        mail_connected: "1",
        provider: state.provider,
      }),
      clearCookieName: pkceCookieName,
    };
  } catch (callbackError) {
    return {
      redirectPath: withReturnQuery(state.returnTo, {
        mail_connected: "0",
        reason:
          callbackError instanceof Error
            ? callbackError.message
            : "Verbindung fehlgeschlagen.",
      }),
      clearCookieName: pkceCookieName,
    };
  }
}

async function revokeGoogleToken(token: string): Promise<void> {
  const body = new URLSearchParams({ token });
  const response = await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok && response.status !== 400) {
    throw new Error("Google Token-Revocation fehlgeschlagen.");
  }
}

async function revokeMicrosoftSessions(accessToken: string): Promise<void> {
  const response = await fetch(
    "https://graph.microsoft.com/v1.0/me/revokeSignInSessions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    },
  );

  if (!response.ok) {
    throw new Error("Microsoft Session-Revocation fehlgeschlagen.");
  }
}

export async function revokeEmailProviderTokens(
  connection: EmailConnection,
): Promise<void> {
  if (connection.provider === "google") {
    await revokeGoogleToken(connection.refreshToken);
    return;
  }

  await revokeMicrosoftSessions(connection.accessToken);
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
    scope: "offline_access Mail.Send Mail.ReadWrite User.Read"
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
