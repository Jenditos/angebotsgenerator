# KI-Angebotsgenerator (Next.js)

Web-App für Handwerker und Dienstleister:
- Formular ausfüllen (Vorname, Nachname, Adresse, E-Mail, Leistung, Stunden, Kosten)
- KI erzeugt den Angebotstext
- PDF wird erzeugt
- Optionaler E-Mail-Versand mit verbundenem Gmail/Outlook oder Resend
- Einstellungen für Firma + Logo (werden in jedes Angebot übernommen)

## Features

- Startseite mit Angebotsformular
- Einstellungen-Seite mit:
  - Firmenname
  - Ansprechpartner
  - Firmenadresse
  - E-Mail, Telefon, Website
  - Kopie-E-Mail
  - Logo-Upload
- API-Route `/api/generate-offer`
- API-Route `/api/settings`
- API-Routen für E-Mail-Verbindung:
  - `/api/email-status`
  - `/api/email/connect`
  - `/api/email/callback`
  - `/api/email/disconnect`
- PDF-Generator via `@react-pdf/renderer`
- OpenAI-Integration mit Fallback-Text, wenn kein API-Key gesetzt ist

## Setup

1. Dependencies installieren:

```bash
npm install
```

2. Umgebungsvariablen setzen:

```bash
cp .env.example .env.local
```

`.env.local`:

```env
OPENAI_API_KEY=
RESEND_API_KEY=
RESEND_FROM_EMAIL=
APP_URL=http://localhost:3000
OAUTH_STATE_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_TENANT_ID=common
```

3. Dev-Server starten:

```bash
npm run dev
```

Dann im Browser `http://localhost:3000` aufrufen.

## Hinweis

- Ohne `OPENAI_API_KEY` nutzt die App automatisch einen lokalen Demo-Angebotstext.
- Direktversand funktioniert über verbundenes Gmail/Outlook oder über `RESEND_*` als Fallback.
- Für OAuth-Provider muss in Google/Microsoft die Redirect-URL auf `${APP_URL}/api/email/callback` gesetzt werden.
- Persistente Nutzerdaten werden standardmäßig updatesicher im Benutzerverzeichnis unter `~/.visioro-data` gespeichert (lokale Runtime).
- Beim ersten Start einer neuen Version werden vorhandene Daten aus dem Legacy-Pfad `./data` automatisch migriert, ohne bestehende Dateien im Zielpfad zu überschreiben.
- Optional kann der Speicherort über `DATA_DIR` (vollständiger Pfad) oder `VISIORO_DATA_HOME` (Basispfad, App nutzt dann `<VISIORO_DATA_HOME>/.visioro-data`) gesetzt werden.
