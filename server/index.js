const express = require("express");
const dotenv = require("dotenv");
const fs = require("fs/promises");
const path = require("path");

dotenv.config();

const app = express();

const PORT = Number(process.env.PORT || 3000);
const GRAPH_VERSION = process.env.GRAPH_VERSION || "v21.0";
const REQUIRED_ENV_VARS = ["APP_ID", "APP_SECRET", "CONFIG_ID", "REDIRECT_URI"];
const DATA_FILE = path.join(__dirname, "..", "data", "whatsapp_connection.json");
const REQUESTED_SCOPES = "business_management,whatsapp_business_management";

class ApiRequestError extends Error {
  constructor(message, phase, status, payload) {
    super(message);
    this.name = "ApiRequestError";
    this.phase = phase;
    this.status = status;
    this.payload = payload;
  }
}

function getMissingEnvVars() {
  return REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function prettyJson(value) {
  return escapeHtml(JSON.stringify(value, null, 2));
}

function basePage(title, heading, bodyHtml) {
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f7fb;
      --card: #ffffff;
      --text: #1f2937;
      --muted: #4b5563;
      --ok: #0f766e;
      --warn: #b45309;
      --error: #b91c1c;
      --line: #e5e7eb;
      --code-bg: #111827;
      --code-text: #f3f4f6;
    }
    body {
      margin: 0;
      background: linear-gradient(180deg, #eef3ff 0%, var(--bg) 45%);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--text);
    }
    main {
      max-width: 860px;
      margin: 28px auto;
      padding: 0 16px;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 20px;
      box-shadow: 0 8px 24px rgba(17, 24, 39, 0.06);
    }
    h1 {
      margin: 0 0 10px 0;
      font-size: 1.4rem;
    }
    p {
      line-height: 1.55;
      margin: 8px 0;
    }
    .muted { color: var(--muted); }
    .ok { color: var(--ok); }
    .warn { color: var(--warn); }
    .error { color: var(--error); }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 12px;
      margin-bottom: 12px;
    }
    th, td {
      text-align: left;
      vertical-align: top;
      border-bottom: 1px solid var(--line);
      padding: 10px 8px;
      font-size: 0.95rem;
    }
    pre {
      margin: 14px 0 0 0;
      overflow: auto;
      background: var(--code-bg);
      color: var(--code-text);
      border-radius: 10px;
      padding: 14px;
      font-size: 0.8rem;
      line-height: 1.45;
    }
    a { color: #1d4ed8; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <main>
    <section class="card">
      <h1>${escapeHtml(heading)}</h1>
      ${bodyHtml}
    </section>
  </main>
</body>
</html>`;
}

function errorPage(statusCode, title, message, details) {
  const detailBlock = details
    ? `<pre>${prettyJson(details)}</pre>`
    : "";

  return {
    statusCode,
    html: basePage(
      title,
      `Fehler (${statusCode})`,
      `<p class="error">${escapeHtml(message)}</p>
       <p class="muted">Wenn du den Embedded Signup gerade abgeschlossen hast, starte den Flow erneut und pruefe vor allem APP_ID, CONFIG_ID und REDIRECT_URI.</p>
       <p><a href="/">Zurueck zur Startseite</a></p>
       ${detailBlock}`
    ),
  };
}

function pickPrimaryConnection(connections) {
  return connections.find((item) => item.phone_number_id) || connections[0] || null;
}

function dedupeConnections(connections) {
  const seen = new Set();
  const deduped = [];

  for (const connection of connections) {
    const key = [
      connection.business_id || "none",
      connection.relation_type || "none",
      connection.waba_id || "none",
      connection.phone_number_id || "none",
    ].join(":");

    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(connection);
    }
  }

  return deduped;
}

async function requestJson(url, phase) {
  let response;

  try {
    response = await fetch(url);
  } catch (error) {
    throw new ApiRequestError(`Netzwerkfehler in Phase ${phase}`, phase, 502, {
      message: error.message,
      url,
    });
  }

  const raw = await response.text();
  let payload;

  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { raw };
  }

  if (!response.ok || payload.error) {
    throw new ApiRequestError(`Fehler in Phase ${phase}`, phase, response.status, payload);
  }

  return payload;
}

async function exchangeCodeForToken(code) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`);
  url.searchParams.set("client_id", process.env.APP_ID);
  url.searchParams.set("client_secret", process.env.APP_SECRET);
  url.searchParams.set("redirect_uri", process.env.REDIRECT_URI);
  url.searchParams.set("code", code);

  const payload = await requestJson(url.toString(), "token_exchange");

  if (!payload.access_token) {
    throw new ApiRequestError("Token-Antwort enthaelt kein access_token", "token_exchange", 502, payload);
  }

  return payload;
}

async function graphGet(nodePath, params, accessToken) {
  const normalizedPath = String(nodePath).replace(/^\/+/, "");
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${normalizedPath}`);

  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  url.searchParams.set("access_token", accessToken);
  return requestJson(url.toString(), "graph_api");
}

function extractConnectionsFromWabaList(business, relationType, wabaList) {
  if (!Array.isArray(wabaList)) {
    return [];
  }

  return wabaList.flatMap((waba) => {
    const phoneNumbers = Array.isArray(waba?.phone_numbers?.data)
      ? waba.phone_numbers.data
      : [];

    if (phoneNumbers.length === 0) {
      return [
        {
          business_id: business?.id || null,
          business_name: business?.name || null,
          relation_type: relationType,
          waba_id: waba?.id || null,
          waba_name: waba?.name || null,
          phone_number_id: null,
          display_phone_number: null,
          name: waba?.name || business?.name || null,
        },
      ];
    }

    return phoneNumbers.map((phone) => ({
      business_id: business?.id || null,
      business_name: business?.name || null,
      relation_type: relationType,
      waba_id: waba?.id || null,
      waba_name: waba?.name || null,
      phone_number_id: phone?.id || null,
      display_phone_number: phone?.display_phone_number || null,
      name: phone?.verified_name || phone?.name || waba?.name || business?.name || null,
    }));
  });
}

async function fetchConnectionsFromGraph(accessToken) {
  const warnings = [];

  const profile = await graphGet(
    "me",
    {
      fields: "id,name",
    },
    accessToken
  ).catch((error) => {
    warnings.push({
      phase: "graph_api",
      message: "Konnte /me Profil nicht laden",
      error: error.payload || { message: error.message },
    });

    return null;
  });

  const businessesResp = await graphGet(
    "me/businesses",
    {
      fields: "id,name",
      limit: 100,
    },
    accessToken
  );

  const businesses = Array.isArray(businessesResp?.data) ? businessesResp.data : [];

  const fields = [
    "id",
    "name",
    "owned_whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number,verified_name,name,status}}",
    "client_whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number,verified_name,name,status}}",
  ].join(",");

  const detailResults = await Promise.all(
    businesses.map(async (business) => {
      try {
        const detail = await graphGet(business.id, { fields }, accessToken);
        return { business, detail };
      } catch (error) {
        warnings.push({
          business_id: business.id,
          business_name: business.name || null,
          message: "Business konnte nicht auf WABA-Informationen abgefragt werden",
          error: error.payload || { message: error.message },
        });

        return null;
      }
    })
  );

  const connections = [];

  for (const entry of detailResults) {
    if (!entry) {
      continue;
    }

    const business = {
      id: entry.detail?.id || entry.business?.id || null,
      name: entry.detail?.name || entry.business?.name || null,
    };

    const ownedList = Array.isArray(entry.detail?.owned_whatsapp_business_accounts?.data)
      ? entry.detail.owned_whatsapp_business_accounts.data
      : [];

    const clientList = Array.isArray(entry.detail?.client_whatsapp_business_accounts?.data)
      ? entry.detail.client_whatsapp_business_accounts.data
      : [];

    connections.push(...extractConnectionsFromWabaList(business, "owned", ownedList));
    connections.push(...extractConnectionsFromWabaList(business, "client", clientList));
  }

  return {
    profile,
    businesses,
    connections: dedupeConnections(connections),
    warnings,
  };
}

async function saveConnectionSnapshot(connectionData) {
  const primary = pickPrimaryConnection(connectionData.connections);

  const payload = {
    saved_at: new Date().toISOString(),
    graph_version: GRAPH_VERSION,
    redirect_uri: process.env.REDIRECT_URI,
    profile: connectionData.profile,
    summary: {
      business_count: connectionData.businesses.length,
      connection_count: connectionData.connections.length,
    },
    primary_connection: primary,
    connections: connectionData.connections,
    warnings: connectionData.warnings,
  };

  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  return payload;
}

function renderSuccessPage(savedSnapshot) {
  const primary = savedSnapshot.primary_connection;

  const summaryRows = [
    ["WABA ID", primary?.waba_id || "Nicht gefunden"],
    ["phone_number_id", primary?.phone_number_id || "Nicht gefunden"],
    ["display_phone_number", primary?.display_phone_number || "Nicht verfuegbar"],
    ["name", primary?.name || "Nicht verfuegbar"],
    ["Datei", DATA_FILE],
  ]
    .map(
      ([label, value]) =>
        `<tr><th>${escapeHtml(label)}</th><td><code>${escapeHtml(String(value))}</code></td></tr>`
    )
    .join("\n");

  const warningHtml = Array.isArray(savedSnapshot.warnings) && savedSnapshot.warnings.length
    ? `<p class="warn">Warnungen: ${escapeHtml(String(savedSnapshot.warnings.length))}. Details unten im JSON.</p>`
    : `<p class="ok">Keine Warnungen aus den Graph-Abfragen.</p>`;

  return basePage(
    "WhatsApp Embedded Signup Ergebnis",
    "WhatsApp Business App erfolgreich verbunden",
    `<p>Die Daten wurden lokal gespeichert und unten komplett ausgegeben.</p>
     <table>${summaryRows}</table>
     ${warningHtml}
     <p><a href="/">Neuen Flow starten</a></p>
     <pre>${prettyJson(savedSnapshot)}</pre>`
  );
}

function extractGraphMessage(payload) {
  if (!payload) {
    return "Unbekannter Fehler";
  }

  if (typeof payload.error?.message === "string") {
    return payload.error.message;
  }

  if (typeof payload.message === "string") {
    return payload.message;
  }

  return "Unbekannter Fehler";
}

function isRedirectUriMismatch(payload) {
  const message = extractGraphMessage(payload).toLowerCase();
  return (
    message.includes("redirect_uri") ||
    message.includes("redirect uri") ||
    message.includes("redirect url")
  );
}

app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/client-config.js", (req, res) => {
  const clientConfig = {
    appId: process.env.APP_ID || "",
    configId: process.env.CONFIG_ID || "",
    redirectUri: process.env.REDIRECT_URI || "",
    graphVersion: GRAPH_VERSION,
    scopes: REQUESTED_SCOPES,
    missingEnvVars: getMissingEnvVars(),
  };

  res.type("application/javascript");
  res.send(`window.APP_CONFIG = ${JSON.stringify(clientConfig)};\n`);
});

app.get("/oauth/callback", async (req, res) => {
  const missingEnvVars = getMissingEnvVars();

  if (missingEnvVars.length > 0) {
    const page = errorPage(
      500,
      "Server-Konfiguration unvollstaendig",
      `Bitte setze folgende Variablen in deiner .env: ${missingEnvVars.join(", ")}`,
      { missing_env_vars: missingEnvVars }
    );
    return res.status(page.statusCode).send(page.html);
  }

  const code = typeof req.query.code === "string" ? req.query.code : "";

  if (!code) {
    const page = errorPage(
      400,
      "Fehlender Code",
      "Im Callback fehlt ?code=. Starte den Embedded Signup erneut ueber den Button.",
      { query: req.query }
    );
    return res.status(page.statusCode).send(page.html);
  }

  try {
    const tokenResponse = await exchangeCodeForToken(code);
    const graphData = await fetchConnectionsFromGraph(tokenResponse.access_token);
    const snapshot = await saveConnectionSnapshot(graphData);

    return res.status(200).send(renderSuccessPage(snapshot));
  } catch (error) {
    if (error instanceof ApiRequestError && error.phase === "token_exchange") {
      const mismatchHint = isRedirectUriMismatch(error.payload)
        ? "Redirect URI Mismatch: Pruefe, dass REDIRECT_URI in .env exakt gleich in der Meta App (Facebook Login for Business Config) eingetragen ist."
        : "Token Exchange fehlgeschlagen.";

      const page = errorPage(
        400,
        "Token Exchange fehlgeschlagen",
        mismatchHint,
        {
          phase: error.phase,
          status: error.status,
          message: extractGraphMessage(error.payload),
          payload: error.payload,
        }
      );

      return res.status(page.statusCode).send(page.html);
    }

    if (error instanceof ApiRequestError && error.phase === "graph_api") {
      const page = errorPage(
        502,
        "Graph API fehlgeschlagen",
        "Token wurde erstellt, aber die Graph-Abfrage fuer WABA/phone_number_id ist fehlgeschlagen.",
        {
          phase: error.phase,
          status: error.status,
          message: extractGraphMessage(error.payload),
          payload: error.payload,
        }
      );

      return res.status(page.statusCode).send(page.html);
    }

    const page = errorPage(500, "Unerwarteter Fehler", error.message || "Unbekannter Fehler", {
      stack: error.stack,
    });

    return res.status(page.statusCode).send(page.html);
  }
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    graphVersion: GRAPH_VERSION,
    missingEnvVars: getMissingEnvVars(),
  });
});

app.listen(PORT, () => {
  const missing = getMissingEnvVars();
  const warning = missing.length
    ? ` | WARN missing env vars: ${missing.join(", ")}`
    : "";

  console.log(`Server running on http://localhost:${PORT}${warning}`);
});
