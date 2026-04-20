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
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_MONTHLY_PRICE_ID=

NEXT_PUBLIC_APP_URL=http://localhost:3003
```

3. Dev-Server starten:

```bash
npm run dev
```

Dann im Browser `http://localhost:3003` aufrufen.

## Supabase einrichten (Auth + Session)

1. In Supabase ein neues Projekt anlegen.
2. Unter `Authentication > Providers` den Provider `Email` aktivieren.
3. Unter `Authentication > URL Configuration` die URLs setzen:
   - `Site URL`: `http://localhost:3003` (oder deine echte öffentliche App-Domain)
   - `Redirect URLs`:
     - `http://localhost:3003/auth/callback`
     - `http://localhost:3003/auth/reset`
4. In Supabase SQL Editor die Migration `supabase/migrations/202603250001_user_access.sql` ausführen, damit die Tabelle `public.user_access` + RLS-Policies existieren.
5. In Supabase unter `Settings > API` diese Werte kopieren und in `.env.local` eintragen:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (nur serverseitig verwenden, niemals im Client)

Optional, aber empfohlen für robuste E-Mail-Bestätigung:
- Unter `Authentication > Email Templates` kann der Bestätigungslink auf den App-Callback zeigen, z. B.:
  - Signup: `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=signup`
  - Recovery: `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/auth/reset`

## Wie die Integration aufgebaut ist

- Browser-Client: `src/lib/supabase/client.ts`
- ENV-Validierung und zentrale Config: `src/lib/supabase/config.ts`
- Server-Client (Cookies/Sessions): `src/lib/supabase/server.ts`
- Middleware-Route-Schutz: `middleware.ts`
- Login/Registrierung/Passwort-Reset:
  - `src/app/auth/page.tsx`
  - `src/app/auth/callback/page.tsx`
  - `src/app/auth/reset/page.tsx`

## Verbindung testen

1. Dev-Server starten:

```bash
npm run dev
```

2. `http://localhost:3003/auth` öffnen und einen Testnutzer registrieren oder einloggen.
3. Prüfen, ob Session + Auth aktiv sind:
   - Im Browser (eingeloggt): `http://localhost:3003/api/access/status`
   - Erwartung: JSON mit `authenticated: true` und User-Daten.
4. Ausloggen und denselben Endpunkt erneut prüfen:
   - Erwartung: `401` / nicht eingeloggt.

## Hinweis

- Ohne `OPENAI_API_KEY` nutzt die App automatisch einen lokalen Demo-Angebotstext.
- Direktversand funktioniert über verbundenes Gmail/Outlook oder über `RESEND_*` als Fallback.
- Für OAuth-Provider muss in Google/Microsoft die Redirect-URL auf `${APP_URL}/api/email/callback` gesetzt werden.
- Persistente Nutzerdaten werden standardmäßig updatesicher im Benutzerverzeichnis unter `~/.visioro-data` gespeichert (lokale Runtime).
- Beim ersten Start einer neuen Version werden vorhandene Daten aus dem Legacy-Pfad `./data` automatisch migriert, ohne bestehende Dateien im Zielpfad zu überschreiben.
- Optional kann der Speicherort über `DATA_DIR` (vollständiger Pfad) oder `VISIORO_DATA_HOME` (Basispfad, App nutzt dann `<VISIORO_DATA_HOME>/.visioro-data`) gesetzt werden.
