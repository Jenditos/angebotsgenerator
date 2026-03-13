"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { getDefaultPdfTableColumns } from "@/lib/pdf-table-config";
import { CompanySettings, PdfTableColumnConfig } from "@/types/offer";

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
  logoDataUrl: "",
  pdfTableColumns: getDefaultPdfTableColumns(),
  customServices: [],
  vatRate: 19,
  offerValidityDays: 30,
  offerTermsText:
    "Dieses Angebot basiert auf den aktuell gültigen Materialpreisen. Änderungen durch unvorhergesehene Baustellenbedingungen bleiben vorbehalten."
};

function sortPdfColumns(columns: PdfTableColumnConfig[]): PdfTableColumnConfig[] {
  return [...columns].sort((a, b) => a.order - b.order);
}

function reindexPdfColumns(columns: PdfTableColumnConfig[]): PdfTableColumnConfig[] {
  return sortPdfColumns(columns).map((column, index) => ({
    ...column,
    order: index
  }));
}

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

  const orderedPdfColumns = useMemo(
    () => sortPdfColumns(settings.pdfTableColumns),
    [settings.pdfTableColumns]
  );

  function updatePdfColumns(updater: (columns: PdfTableColumnConfig[]) => PdfTableColumnConfig[]) {
    setSettings((prev) => ({
      ...prev,
      pdfTableColumns: updater(prev.pdfTableColumns)
    }));
  }

  function togglePdfColumnVisibility(columnId: PdfTableColumnConfig["id"], visible: boolean) {
    updatePdfColumns((columns) =>
      columns.map((column) => (column.id === columnId ? { ...column, visible } : column))
    );
  }

  function updatePdfColumnLabel(columnId: PdfTableColumnConfig["id"], label: string) {
    updatePdfColumns((columns) =>
      columns.map((column) => (column.id === columnId ? { ...column, label } : column))
    );
  }

  function movePdfColumn(columnId: PdfTableColumnConfig["id"], direction: "up" | "down") {
    updatePdfColumns((columns) => {
      const sorted = sortPdfColumns(columns);
      const currentIndex = sorted.findIndex((column) => column.id === columnId);
      if (currentIndex < 0) {
        return columns;
      }

      const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
      if (targetIndex < 0 || targetIndex >= sorted.length) {
        return columns;
      }

      const currentColumn = sorted[currentIndex];
      const targetColumn = sorted[targetIndex];

      return reindexPdfColumns(
        columns.map((column) => {
          if (column.id === currentColumn.id) {
            return { ...column, order: targetColumn.order };
          }
          if (column.id === targetColumn.id) {
            return { ...column, order: currentColumn.order };
          }
          return column;
        })
      );
    });
  }

  function resetPdfColumns() {
    setSettings((prev) => ({
      ...prev,
      pdfTableColumns: getDefaultPdfTableColumns()
    }));
  }

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

            <label className="field">
              <span>MwSt. (%) für PDF</span>
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={settings.vatRate}
                onChange={(e) => setSettings((prev) => ({ ...prev, vatRate: Number(e.target.value) }))}
              />
            </label>

            <label className="field">
              <span>Angebotsgültigkeit (Tage)</span>
              <input
                type="number"
                min="1"
                max="365"
                step="1"
                value={settings.offerValidityDays}
                onChange={(e) => setSettings((prev) => ({ ...prev, offerValidityDays: Number(e.target.value) }))}
              />
            </label>

            <label className="field span2">
              <span>Hinweis / Bedingungen im PDF</span>
              <textarea
                rows={4}
                value={settings.offerTermsText}
                onChange={(e) => setSettings((prev) => ({ ...prev, offerTermsText: e.target.value }))}
                placeholder="z. B. Zahlungsbedingungen oder Angebotsbedingungen"
              />
            </label>

            <div className="field span2 settingsPdfColumnsField">
              <span>PDF-Tabellenspalten</span>
              <div className="settingsPdfColumnsPanel">
                <p className="settingsPdfColumnsHint">
                  Lege fest, welche Spalten im Angebots-PDF sichtbar sind und in welcher Reihenfolge sie erscheinen.
                </p>
                <div className="settingsPdfColumnsList">
                  {orderedPdfColumns.map((column, index) => {
                    const isFirst = index === 0;
                    const isLast = index === orderedPdfColumns.length - 1;

                    return (
                      <div key={column.id} className="settingsPdfColumnsRow">
                        <label className="settingsPdfColumnsToggle">
                          <input
                            type="checkbox"
                            checked={column.visible}
                            onChange={(event) => togglePdfColumnVisibility(column.id, event.target.checked)}
                          />
                          <span>Sichtbar</span>
                        </label>

                        <input
                          value={column.label}
                          onChange={(event) => updatePdfColumnLabel(column.id, event.target.value)}
                          placeholder="Spaltenname"
                        />

                        <div className="settingsPdfColumnsActions">
                          <button
                            type="button"
                            className="settingsPdfColumnsOrderButton"
                            disabled={isFirst}
                            onClick={() => movePdfColumn(column.id, "up")}
                            aria-label={`${column.label} nach oben`}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="settingsPdfColumnsOrderButton"
                            disabled={isLast}
                            onClick={() => movePdfColumn(column.id, "down")}
                            aria-label={`${column.label} nach unten`}
                          >
                            ↓
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <button type="button" className="ghostButton settingsPdfColumnsReset" onClick={resetPdfColumns}>
                  Standardspalten wiederherstellen
                </button>
              </div>
            </div>

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
