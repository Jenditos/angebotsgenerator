"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";

type OfferText = {
  subject: string;
  intro: string;
  details: string;
  closing: string;
};

type ApiResponse = {
  offer: OfferText;
  mailText: string;
  pdfBase64: string;
  emailStatus: "not_requested" | "sent" | "not_configured" | "failed";
  emailInfo: string;
};

type ParsedVoiceFields = {
  customerType?: "person" | "company";
  companyName?: string;
  salutation?: "herr" | "frau";
  firstName?: string;
  lastName?: string;
  street?: string;
  postalCode?: string;
  city?: string;
  customerEmail?: string;
  serviceDescription?: string;
  hours?: number;
  hourlyRate?: number;
  materialCost?: number;
};

type VoiceParseResponse = {
  fields: ParsedVoiceFields;
  missingFields: string[];
  usedFallback: boolean;
  fallbackReason?: "no_api_key" | "model_error" | null;
};

type NominatimItem = {
  display_name?: string;
  address?: {
    road?: string;
    house_number?: string;
    postcode?: string;
    city?: string;
    town?: string;
    village?: string;
    hamlet?: string;
    municipality?: string;
  };
};

type AddressSuggestion = {
  street: string;
  postalCode: string;
  city: string;
  primary: string;
  secondary: string;
};

type OfferForm = {
  customerType: "person" | "company";
  companyName: string;
  salutation: "herr" | "frau";
  firstName: string;
  lastName: string;
  street: string;
  postalCode: string;
  city: string;
  customerEmail: string;
  serviceDescription: string;
  hours: string;
  hourlyRate: string;
  materialCost: string;
};

const initialForm: OfferForm = {
  customerType: "person",
  companyName: "",
  salutation: "herr",
  firstName: "",
  lastName: "",
  street: "",
  postalCode: "",
  city: "",
  customerEmail: "",
  serviceDescription: "",
  hours: "",
  hourlyRate: "",
  materialCost: ""
};

function normalizeAddressSuggestion(item: NominatimItem): AddressSuggestion | null {
  const road = item.address?.road?.trim() ?? "";
  const houseNumber = item.address?.house_number?.trim() ?? "";
  const postalCode = item.address?.postcode?.trim() ?? "";
  const city =
    item.address?.city?.trim() ??
    item.address?.town?.trim() ??
    item.address?.village?.trim() ??
    item.address?.hamlet?.trim() ??
    item.address?.municipality?.trim() ??
    "";

  const street = [road, houseNumber].filter(Boolean).join(" ").trim();
  if (!street && !postalCode && !city) {
    return null;
  }

  const primary = street || item.display_name?.trim() || "Adresse auswählen";
  const secondary = [postalCode, city].filter(Boolean).join(" ").trim() || item.display_name?.trim() || "";

  return {
    street,
    postalCode,
    city,
    primary,
    secondary
  };
}

export default function HomePage() {
  const [form, setForm] = useState<OfferForm>(initialForm);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [error, setError] = useState("");
  const [postActionInfo, setPostActionInfo] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([]);
  const [isAddressLoading, setIsAddressLoading] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [isParsingVoice, setIsParsingVoice] = useState(false);
  const [voiceInfo, setVoiceInfo] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const recognitionRef = useRef<any>(null);
  const finalTranscriptRef = useRef("");

  const personDisplayName = `${form.firstName} ${form.lastName}`.trim();
  const customerDisplayName =
    form.customerType === "company"
      ? form.companyName.trim() || "Firmenname"
      : personDisplayName || "Vorname Nachname";
  const attentionLine =
    form.customerType === "company" && personDisplayName
      ? `z. Hd. ${form.salutation === "frau" ? "Frau" : "Herr"} ${personDisplayName}`
      : "";
  const hoursNumber = Number(form.hours || 0);
  const hourlyRateNumber = Number(form.hourlyRate || 0);
  const materialNumber = Number(form.materialCost || 0);
  const liveTotal = hoursNumber * hourlyRateNumber + materialNumber;

  useEffect(() => {
    const speechCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setSpeechSupported(Boolean(speechCtor));

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const street = form.street.trim();
    if (street.length < 3) {
      setAddressSuggestions([]);
      setIsAddressLoading(false);
      return;
    }

    const searchText = [street, form.postalCode.trim(), form.city.trim()].filter(Boolean).join(" ");
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsAddressLoading(true);

      try {
        const params = new URLSearchParams({
          format: "jsonv2",
          addressdetails: "1",
          limit: "5",
          countrycodes: "de,at,ch",
          q: searchText
        });

        const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
          signal: controller.signal,
          headers: {
            "Accept-Language": "de"
          }
        });

        if (!response.ok) {
          setAddressSuggestions([]);
          return;
        }

        const data = (await response.json()) as NominatimItem[];
        const normalized = data
          .map(normalizeAddressSuggestion)
          .filter((item): item is AddressSuggestion => Boolean(item))
          .filter(
            (item, index, all) =>
              all.findIndex(
                (entry) =>
                  entry.street === item.street &&
                  entry.postalCode === item.postalCode &&
                  entry.city === item.city &&
                  entry.primary === item.primary
              ) === index
          );

        setAddressSuggestions(normalized);
      } catch (fetchError) {
        if ((fetchError as { name?: string }).name !== "AbortError") {
          setAddressSuggestions([]);
        }
      } finally {
        setIsAddressLoading(false);
      }
    }, 280);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [form.street, form.postalCode, form.city]);

  function applyAddressSuggestion(suggestion: AddressSuggestion) {
    setForm((prev) => ({
      ...prev,
      street: suggestion.street || prev.street,
      postalCode: suggestion.postalCode || prev.postalCode,
      city: suggestion.city || prev.city
    }));
    setAddressSuggestions([]);
  }

  function startSpeechInput() {
    if (isListening) {
      return;
    }

    const speechCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!speechCtor) {
      setVoiceError("Spracherkennung wird auf diesem Gerät/Browser nicht unterstützt.");
      return;
    }

    setVoiceError("");
    setVoiceInfo("Sprich jetzt. Du kannst frei alle Angebotsdaten diktieren.");
    finalTranscriptRef.current = voiceTranscript.trim();

    const recognition = new speechCtor();
    recognition.lang = "de-DE";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event: any) => {
      let interimTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const text = String(event.results[i][0]?.transcript ?? "");
        if (event.results[i].isFinal) {
          finalTranscriptRef.current = `${finalTranscriptRef.current} ${text}`.trim();
        } else {
          interimTranscript += text;
        }
      }
      setVoiceTranscript(`${finalTranscriptRef.current} ${interimTranscript}`.trim());
    };

    recognition.onerror = (event: any) => {
      const code = String(event.error ?? "");
      if (code === "not-allowed" || code === "service-not-allowed") {
        setVoiceError("Mikrofonzugriff wurde blockiert. Bitte Zugriff im Browser erlauben.");
      } else if (code === "no-speech") {
        setVoiceError("Keine Sprache erkannt. Bitte erneut sprechen.");
      } else {
        setVoiceError("Spracherkennung fehlgeschlagen. Bitte erneut versuchen.");
      }
      recognitionRef.current = null;
      setIsListening(false);
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      setIsListening(false);
      setVoiceInfo("Aufnahme beendet. Klicke auf 'In Felder übernehmen'.");
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
      setIsListening(true);
    } catch {
      recognitionRef.current = null;
      setIsListening(false);
      setVoiceError("Aufnahme konnte nicht gestartet werden. Bitte erneut versuchen.");
      setVoiceInfo("");
    }
  }

  function stopSpeechInput() {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setVoiceInfo("Aufnahme wird beendet ...");
    }
  }

  function numberToInput(value: number | undefined): string | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return undefined;
    }
    return String(value);
  }

  function sanitizeServiceDescription(value: string | undefined, transcript: string): string | undefined {
    if (!value) {
      return undefined;
    }

    const cleaned = value.trim();
    if (cleaned.length < 3 || cleaned.length > 140) {
      return undefined;
    }

    const normalizedValue = cleaned.toLowerCase().replace(/\s+/g, " ").trim();
    const normalizedTranscript = transcript.toLowerCase().replace(/\s+/g, " ").trim();
    if (!normalizedTranscript) {
      return cleaned;
    }

    if (normalizedValue === normalizedTranscript) {
      return undefined;
    }

    const wordCount = normalizedValue.split(" ").filter(Boolean).length;
    if (normalizedTranscript.includes(normalizedValue) && wordCount > 16) {
      return undefined;
    }

    return cleaned;
  }

  async function applyVoiceTranscript() {
    if (isListening) {
      stopSpeechInput();
    }

    const transcript = voiceTranscript.trim();
    if (transcript.length < 8) {
      setVoiceError("Bitte etwas länger sprechen, damit die KI genug Daten hat.");
      return;
    }

    setIsParsingVoice(true);
    setVoiceError("");

    try {
      const response = await fetch("/api/parse-intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript })
      });
      const data = (await response.json()) as VoiceParseResponse & { error?: string };
      if (!response.ok) {
        setVoiceError(data.error ?? "Sprachdaten konnten nicht verarbeitet werden.");
        return;
      }

      const fields = data.fields;
      const safeServiceDescription = sanitizeServiceDescription(fields.serviceDescription, transcript);
      const applyConservativeFallback = data.usedFallback;
      setForm((prev) => ({
        ...prev,
        customerType: fields.customerType ?? prev.customerType,
        companyName: fields.companyName ?? prev.companyName,
        salutation: fields.salutation ?? prev.salutation,
        firstName: applyConservativeFallback ? prev.firstName : fields.firstName ?? prev.firstName,
        lastName: applyConservativeFallback ? prev.lastName : fields.lastName ?? prev.lastName,
        street: fields.street ?? prev.street,
        postalCode: fields.postalCode ?? prev.postalCode,
        city: fields.city ?? prev.city,
        customerEmail: fields.customerEmail ?? prev.customerEmail,
        serviceDescription: applyConservativeFallback ? prev.serviceDescription : safeServiceDescription ?? prev.serviceDescription,
        hours: numberToInput(fields.hours) ?? prev.hours,
        hourlyRate: numberToInput(fields.hourlyRate) ?? prev.hourlyRate,
        materialCost: numberToInput(fields.materialCost) ?? prev.materialCost
      }));

      const missingText =
        data.missingFields.length > 0
          ? ` Bitte noch ergänzen: ${data.missingFields.join(", ")}.`
          : " Alle Kernfelder wurden erkannt.";
      const modeText = data.usedFallback ? "Sprachdaten übernommen." : "Sprachtext per KI übernommen.";
      setVoiceInfo(`${modeText}${missingText}`);
      setVoiceError("");
      setAddressSuggestions([]);
    } catch {
      setVoiceError("Netzwerkfehler bei der Sprachverarbeitung.");
    } finally {
      setIsParsingVoice(false);
    }
  }

  function createPdfFile(pdfBase64: string) {
    const binary = atob(pdfBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new File([bytes], "angebot.pdf", { type: "application/pdf" });
  }

  function downloadPdfFile(file: File) {
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function openMailDraftWithOffer(payload: ApiResponse) {
    const mailText = payload.mailText;
    const file = createPdfFile(payload.pdfBase64);

    if (typeof navigator !== "undefined" && "canShare" in navigator && "share" in navigator) {
      const nav = navigator as Navigator & {
        canShare?: (data?: ShareData) => boolean;
      };
      if (nav.canShare?.({ files: [file] })) {
        try {
          await navigator.share({
            title: payload.offer.subject,
            text: mailText,
            files: [file]
          });
          return "Mail-Entwurf über den Teilen-Dialog geöffnet.";
        } catch {
          // Ignore and fallback to mailto + download.
        }
      }
    }

    const mailtoUrl =
      `mailto:${encodeURIComponent(form.customerEmail)}` +
      `?subject=${encodeURIComponent(payload.offer.subject)}` +
      `&body=${encodeURIComponent(mailText)}`;

    window.location.href = mailtoUrl;
    downloadPdfFile(file);
    return "Mailfenster geöffnet. PDF wurde heruntergeladen und kann direkt angehängt werden.";
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setResult(null);
    setPostActionInfo("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/generate-offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, sendEmail: false })
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Unbekannter Fehler");
        return;
      }

      const payload = data as ApiResponse;
      setResult(payload);
      const info = await openMailDraftWithOffer(payload);
      setPostActionInfo(info);
    } catch {
      setError("Netzwerkfehler. Bitte erneut versuchen.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="page">
      <div className="ambient ambientA" aria-hidden />
      <div className="ambient ambientB" aria-hidden />
      <div className="container">
        <header className="topBar glassCard">
          <div className="topBarBrand">
            <span className="pill">Visioro</span>
            <strong>Angebote für Handwerker</strong>
          </div>
          <Link href="/settings" className="ghostButton topBarButton">
            Einstellungen
          </Link>
        </header>

        <section className="hero glassCard">
          <p className="heroEyebrow">Visioro</p>
          <h1>Angebote in Minuten statt in Stunden</h1>
          <p className="heroText">
            Du gibst Kundendaten und Leistung ein, Visioro erstellt den Text, baut ein sauberes PDF und öffnet direkt
            deinen Mail-Entwurf.
          </p>
          <div className="stepRow">
            <article className="stepTile">
              <span>1</span>
              <strong>Kundendaten erfassen</strong>
            </article>
            <article className="stepTile">
              <span>2</span>
              <strong>Text + PDF generieren</strong>
            </article>
            <article className="stepTile">
              <span>3</span>
              <strong>Mail-Entwurf absenden</strong>
            </article>
          </div>
        </section>

        <section className="workspaceGrid">
          <article className="glassCard formCard">
            <header className="sectionHeader">
              <h2>Daten für das Angebot</h2>
              <p>Hier triffst du alle Angaben, die dein Kunde im Angebot sehen soll.</p>
            </header>

            <form onSubmit={onSubmit} className="formGrid">
              <div className="voicePanel span2">
                <div className="voicePanelHeader">
                  <strong>Per Sprache ausfüllen</strong>
                  <p>Sprich frei alle Daten ein, danach werden die Felder automatisch befüllt.</p>
                </div>

                <div className="voiceActions">
                  <button
                    type="button"
                    className={`ghostButton voiceActionButton ${isListening ? "voiceActionButtonStop" : "voiceActionButtonStart"}`}
                    onClick={isListening ? stopSpeechInput : startSpeechInput}
                    disabled={!speechSupported || isParsingVoice}
                  >
                    {isListening ? "Aufnahme stoppen" : "Aufnahme starten"}
                  </button>
                  <button
                    type="button"
                    className="ghostButton voiceActionButton"
                    onClick={applyVoiceTranscript}
                    disabled={isParsingVoice || !voiceTranscript.trim()}
                  >
                    {isParsingVoice ? "Übernehme Felder ..." : "In Felder übernehmen"}
                  </button>
                </div>

                <label className="field">
                  <span>Gesprochener Text</span>
                  <textarea
                    rows={4}
                    value={voiceTranscript}
                    onChange={(e) => setVoiceTranscript(e.target.value)}
                    placeholder="Beispiel: Firma Schmidt GmbH, Ansprechpartner Herr Müller, Musterstraße 5, 10115 Berlin, ..."
                  />
                </label>

                {!speechSupported ? <p className="voiceWarning">Spracherkennung wird auf diesem Browser nicht unterstützt.</p> : null}
                {voiceInfo ? (
                  <p className="voiceInfo" role="status" aria-live="polite">
                    {voiceInfo}
                  </p>
                ) : null}
                {voiceError ? (
                  <p className="voiceWarning" role="alert">
                    {voiceError}
                  </p>
                ) : null}
              </div>

              <div className="recipientType span2" role="group" aria-label="Kundenart">
                <span>Kundenart</span>
                <div className="recipientTypeButtons">
                  <button
                    type="button"
                    className={`recipientTypeButton ${form.customerType === "person" ? "active" : ""}`}
                    onClick={() => setForm((prev) => ({ ...prev, customerType: "person" }))}
                  >
                    Privatperson
                  </button>
                  <button
                    type="button"
                    className={`recipientTypeButton ${form.customerType === "company" ? "active" : ""}`}
                    onClick={() => setForm((prev) => ({ ...prev, customerType: "company" }))}
                  >
                    Firma
                  </button>
                </div>
              </div>

              {form.customerType === "company" ? (
                <label className="field span2">
                  <span>Firma</span>
                  <input
                    required
                    autoComplete="organization"
                    value={form.companyName}
                    onChange={(e) => setForm((prev) => ({ ...prev, companyName: e.target.value }))}
                  />
                </label>
              ) : null}

              <label className="field span2">
                <span>{form.customerType === "company" ? "Anrede Ansprechpartner (optional)" : "Anrede"}</span>
                <select
                  required={form.customerType === "person"}
                  value={form.salutation}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      salutation: e.target.value === "frau" ? "frau" : "herr"
                    }))
                  }
                >
                  <option value="herr">Herr</option>
                  <option value="frau">Frau</option>
                </select>
              </label>

              <label className="field">
                <span>Vorname</span>
                <input
                  required={form.customerType === "person"}
                  autoComplete="given-name"
                  value={form.firstName}
                  onChange={(e) => setForm((prev) => ({ ...prev, firstName: e.target.value }))}
                />
              </label>

              <label className="field">
                <span>Nachname</span>
                <input
                  required={form.customerType === "person"}
                  autoComplete="family-name"
                  value={form.lastName}
                  onChange={(e) => setForm((prev) => ({ ...prev, lastName: e.target.value }))}
                />
              </label>

              <label className="field span2">
                <span>Straße und Hausnummer</span>
                <div className="addressAutocomplete">
                  <input
                    required
                    autoComplete="address-line1"
                    value={form.street}
                    onChange={(e) => setForm((prev) => ({ ...prev, street: e.target.value }))}
                  />
                  {(isAddressLoading || addressSuggestions.length > 0) && (
                    <div className="addressSuggestions" role="listbox" aria-label="Adressvorschläge">
                      {isAddressLoading ? <p className="addressHint">Suche Adressen ...</p> : null}
                      {addressSuggestions.map((suggestion, index) => (
                        <button
                          key={`${suggestion.primary}-${suggestion.secondary}-${index}`}
                          type="button"
                          className="addressSuggestionButton"
                          onClick={() => applyAddressSuggestion(suggestion)}
                        >
                          <strong>{suggestion.primary}</strong>
                          {suggestion.secondary ? <span>{suggestion.secondary}</span> : null}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </label>

              <label className="field">
                <span>PLZ</span>
                <input
                  required
                  autoComplete="postal-code"
                  value={form.postalCode}
                  onChange={(e) => setForm((prev) => ({ ...prev, postalCode: e.target.value }))}
                />
              </label>

              <label className="field">
                <span>Ort</span>
                <input
                  required
                  autoComplete="address-level2"
                  value={form.city}
                  onChange={(e) => setForm((prev) => ({ ...prev, city: e.target.value }))}
                />
              </label>

              <label className="field">
                <span>Kunden-E-Mail</span>
                <input
                  required
                  type="email"
                  autoComplete="email"
                  value={form.customerEmail}
                  onChange={(e) => setForm((prev) => ({ ...prev, customerEmail: e.target.value }))}
                />
              </label>

              <label className="field span2">
                <span>Leistung / Projektbeschreibung</span>
                <textarea
                  required
                  rows={4}
                  placeholder="z. B. Reparatur, Montage, Wartung oder Renovierungsarbeiten"
                  value={form.serviceDescription}
                  onChange={(e) => setForm((prev) => ({ ...prev, serviceDescription: e.target.value }))}
                />
              </label>

              <label className="field">
                <span>Stunden</span>
                <input
                  required
                  type="number"
                  min="0"
                  step="0.5"
                  value={form.hours}
                  onChange={(e) => setForm((prev) => ({ ...prev, hours: e.target.value }))}
                />
              </label>

              <label className="field">
                <span>Stundensatz (EUR)</span>
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.hourlyRate}
                  onChange={(e) => setForm((prev) => ({ ...prev, hourlyRate: e.target.value }))}
                />
              </label>

              <label className="field span2">
                <span>Materialkosten (EUR)</span>
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.materialCost}
                  onChange={(e) => setForm((prev) => ({ ...prev, materialCost: e.target.value }))}
                />
              </label>

              <button className="primaryButton submitButton" type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Angebot wird erstellt..." : "Angebot erstellen und Mail-Entwurf öffnen"}
              </button>
            </form>

            {error ? <p className="error">{error}</p> : null}
          </article>

          <aside className="glassCard previewPanel">
            <header className="sectionHeader">
              <h2>Vorschau für deinen Kunden</h2>
              <p>So sieht die Angebots-E-Mail in etwa aus.</p>
            </header>

            <div className="previewAddress">
              <strong>{customerDisplayName}</strong>
              {attentionLine ? <span>{attentionLine}</span> : null}
              <span>{form.street || "Straße 1"}</span>
              <span>{`${form.postalCode || "12345"} ${form.city || "Stadt"}`}</span>
            </div>

            <div className="previewContact">
              <span>E-Mail</span>
              <strong>{form.customerEmail || "kunde@example.com"}</strong>
            </div>

            <div className="quoteSheet">
              <div className="quoteHeader">
                <span>Leistungsübersicht</span>
                <strong>{form.serviceDescription || "Leistung noch nicht angegeben"}</strong>
              </div>

              <div className="quoteRow">
                <span>Arbeitszeit</span>
                <span>
                  {hoursNumber || 0} Std. x {hourlyRateNumber || 0} EUR
                </span>
              </div>
              <div className="quoteRow">
                <span>Material</span>
                <span>{materialNumber || 0} EUR</span>
              </div>
              <div className="quoteTotal">
                <span>Gesamtsumme</span>
                <strong>{Number.isFinite(liveTotal) ? `${liveTotal.toFixed(2)} EUR` : "0.00 EUR"}</strong>
              </div>

              <p className="quoteHint">Bei Klick auf den Button öffnet sich dein Mail-Entwurf zum finalen Senden.</p>
            </div>
          </aside>
        </section>

        {result ? (
          <section className="glassCard resultCard">
            <header className="sectionHeader">
              <h2>Ergebnis</h2>
              <p>Angebot wurde erstellt und als PDF bereitgestellt.</p>
            </header>

            <p>{postActionInfo || result.emailInfo}</p>

            <a
              className="primaryButton"
              href={`data:application/pdf;base64,${result.pdfBase64}`}
              download="angebot.pdf"
            >
              PDF herunterladen
            </a>

            <div className="offerText">
              <h3>Generierter Angebotstext</h3>
              <p>{result.offer.intro}</p>
              <p>{result.offer.details}</p>
              <p>{result.offer.closing}</p>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
