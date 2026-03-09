"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useEffect, useState } from "react";

type CompanySettings = {
  companyName: string;
  ownerName: string;
  companyStreet: string;
  companyPostalCode: string;
  companyCity: string;
  companyEmail: string;
  companyPhone: string;
  companyWebsite: string;
  senderCopyEmail: string;
  logoDataUrl: string;
};

const emptySettings: CompanySettings = {
  companyName: "",
  ownerName: "",
  companyStreet: "",
  companyPostalCode: "",
  companyCity: "",
  companyEmail: "",
  companyPhone: "",
  companyWebsite: "",
  senderCopyEmail: "",
  logoDataUrl: ""
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<CompanySettings>(emptySettings);
  const [saveStatus, setSaveStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadSettings() {
      try {
        const response = await fetch("/api/settings");
        const data = await response.json();
        if (mounted) {
          setSettings(data.settings as CompanySettings);
        }
      } catch {
        if (mounted) {
          setError("Einstellungen konnten nicht geladen werden.");
        }
      }
    }

    void loadSettings();

    return () => {
      mounted = false;
    };
  }, []);

  async function onLogoUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Datei konnte nicht gelesen werden."));
      reader.readAsDataURL(file);
    });

    setSettings((prev) => ({ ...prev, logoDataUrl: dataUrl }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveStatus("");
    setError("");

    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings)
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Speichern fehlgeschlagen");
        return;
      }

      setSettings(data.settings as CompanySettings);
      setSaveStatus("Einstellungen gespeichert.");
    } catch {
      setError("Netzwerkfehler beim Speichern.");
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
            <strong>Firmeneinstellungen</strong>
          </div>
          <Link href="/" className="ghostButton topBarButton">
            Zur Angebotserstellung
          </Link>
        </header>

        <section className="hero glassCard compactHero">
          <p className="heroEyebrow">Einmal einrichten</p>
          <h1>Diese Daten erscheinen auf jedem Angebot</h1>
          <p className="heroText">
            Dein Logo sowie deine Kontakt- und Firmendaten werden automatisch in PDF und Mail-Entwurf übernommen.
          </p>
        </section>

        <section className="glassCard formCard">
          <form onSubmit={onSubmit} className="formGrid">
            <label className="field">
              <span>Firmenname</span>
              <input
                required
                value={settings.companyName}
                onChange={(e) => setSettings((prev) => ({ ...prev, companyName: e.target.value }))}
              />
            </label>

            <label className="field">
              <span>Ansprechpartner</span>
              <input
                required
                value={settings.ownerName}
                onChange={(e) => setSettings((prev) => ({ ...prev, ownerName: e.target.value }))}
              />
            </label>

            <label className="field span2">
              <span>Firmenadresse</span>
              <input
                required
                value={settings.companyStreet}
                onChange={(e) => setSettings((prev) => ({ ...prev, companyStreet: e.target.value }))}
              />
            </label>

            <label className="field">
              <span>PLZ</span>
              <input
                required
                value={settings.companyPostalCode}
                onChange={(e) => setSettings((prev) => ({ ...prev, companyPostalCode: e.target.value }))}
              />
            </label>

            <label className="field">
              <span>Ort</span>
              <input
                required
                value={settings.companyCity}
                onChange={(e) => setSettings((prev) => ({ ...prev, companyCity: e.target.value }))}
              />
            </label>

            <label className="field">
              <span>Firmen-E-Mail</span>
              <input
                required
                type="email"
                value={settings.companyEmail}
                onChange={(e) => setSettings((prev) => ({ ...prev, companyEmail: e.target.value }))}
              />
            </label>

            <label className="field">
              <span>Telefon</span>
              <input
                value={settings.companyPhone}
                onChange={(e) => setSettings((prev) => ({ ...prev, companyPhone: e.target.value }))}
              />
            </label>

            <label className="field">
              <span>Website</span>
              <input
                value={settings.companyWebsite}
                onChange={(e) => setSettings((prev) => ({ ...prev, companyWebsite: e.target.value }))}
              />
            </label>

            <label className="field span2">
              <span>Interne Kopie per E-Mail (optional)</span>
              <input
                type="email"
                value={settings.senderCopyEmail}
                onChange={(e) => setSettings((prev) => ({ ...prev, senderCopyEmail: e.target.value }))}
              />
            </label>

            <label className="field span2">
              <span>Firmenlogo</span>
              <input type="file" accept="image/*" onChange={onLogoUpload} />
            </label>

            {settings.logoDataUrl ? (
              <div className="logoFrame span2">
                <img src={settings.logoDataUrl} alt="Logo Vorschau" className="logoPreview" />
              </div>
            ) : null}

            <button type="submit" className="primaryButton submitButton">
              Einstellungen speichern
            </button>
          </form>
          {saveStatus ? <p className="success">{saveStatus}</p> : null}
          {error ? <p className="error">{error}</p> : null}
        </section>
      </div>
    </main>
  );
}
