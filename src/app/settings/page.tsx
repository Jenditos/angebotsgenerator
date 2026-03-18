"use client";

import Link from "next/link";
import {
  ChangeEvent,
  DragEvent,
  FormEvent,
  PointerEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
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
  invoicePaymentDueDays: 14,
  offerTermsText:
    "Dieses Angebot basiert auf den aktuell gültigen Materialpreisen. Änderungen durch unvorhergesehene Baustellenbedingungen bleiben vorbehalten.",
  lastOfferNumber: "",
  customServiceTypes: [],
};

function sortPdfColumns(
  columns: PdfTableColumnConfig[],
): PdfTableColumnConfig[] {
  return [...columns].sort((a, b) => a.order - b.order);
}

type InvoiceDuePreset = "immediate" | "seven" | "fourteen" | "custom";

function toInvoiceDuePreset(days: number): InvoiceDuePreset {
  if (days === 0) {
    return "immediate";
  }
  if (days === 7) {
    return "seven";
  }
  if (days === 14) {
    return "fourteen";
  }
  return "custom";
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<CompanySettings>(emptySettings);
  const [saveStatus, setSaveStatus] = useState("");
  const [error, setError] = useState("");
  const [invoiceDuePreset, setInvoiceDuePreset] =
    useState<InvoiceDuePreset>("fourteen");
  const [customInvoiceDueDays, setCustomInvoiceDueDays] = useState("");
  const [invoiceDueInitialized, setInvoiceDueInitialized] = useState(false);
  const [draggingPdfColumnId, setDraggingPdfColumnId] = useState<
    PdfTableColumnConfig["id"] | null
  >(null);
  const [dragOverPdfColumnId, setDragOverPdfColumnId] = useState<
    PdfTableColumnConfig["id"] | null
  >(null);

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

  useEffect(() => {
    if (invoiceDueInitialized) {
      return;
    }

    const normalizedDays = Number.isFinite(settings.invoicePaymentDueDays)
      ? Math.max(0, Math.floor(settings.invoicePaymentDueDays))
      : 14;
    const preset = toInvoiceDuePreset(normalizedDays);
    setInvoiceDuePreset(preset);
    setCustomInvoiceDueDays(preset === "custom" ? String(normalizedDays) : "");
    setInvoiceDueInitialized(true);
  }, [invoiceDueInitialized, settings.invoicePaymentDueDays]);

  const orderedPdfColumns = useMemo(
    () => sortPdfColumns(settings.pdfTableColumns),
    [settings.pdfTableColumns],
  );

  function updatePdfColumns(
    updater: (columns: PdfTableColumnConfig[]) => PdfTableColumnConfig[],
  ) {
    setSettings((prev) => ({
      ...prev,
      pdfTableColumns: updater(prev.pdfTableColumns),
    }));
  }

  function togglePdfColumnVisibility(
    columnId: PdfTableColumnConfig["id"],
    visible: boolean,
  ) {
    updatePdfColumns((columns) =>
      columns.map((column) =>
        column.id === columnId ? { ...column, visible } : column,
      ),
    );
  }

  function updatePdfColumnLabel(
    columnId: PdfTableColumnConfig["id"],
    label: string,
  ) {
    updatePdfColumns((columns) =>
      columns.map((column) =>
        column.id === columnId ? { ...column, label } : column,
      ),
    );
  }

  function reorderPdfColumnsByDrag(
    sourceId: PdfTableColumnConfig["id"],
    targetId: PdfTableColumnConfig["id"],
  ) {
    if (sourceId === targetId) {
      return;
    }

    updatePdfColumns((columns) => {
      const sorted = sortPdfColumns(columns);
      const sourceIndex = sorted.findIndex((column) => column.id === sourceId);
      const targetIndex = sorted.findIndex((column) => column.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) {
        return columns;
      }

      const nextSorted = [...sorted];
      const [movedColumn] = nextSorted.splice(sourceIndex, 1);
      nextSorted.splice(targetIndex, 0, movedColumn);

      return nextSorted.map((column, index) => ({
        ...column,
        order: index,
      }));
    });
  }

  function handlePdfColumnDragStart(
    event: DragEvent<HTMLButtonElement>,
    columnId: PdfTableColumnConfig["id"],
  ) {
    setDraggingPdfColumnId(columnId);
    setDragOverPdfColumnId(columnId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", columnId);
  }

  function handlePdfColumnDragOver(
    event: DragEvent<HTMLDivElement>,
    targetId: PdfTableColumnConfig["id"],
  ) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverPdfColumnId(targetId);
  }

  function handlePdfColumnDrop(
    event: DragEvent<HTMLDivElement>,
    targetId: PdfTableColumnConfig["id"],
  ) {
    event.preventDefault();
    if (!draggingPdfColumnId) {
      return;
    }
    reorderPdfColumnsByDrag(draggingPdfColumnId, targetId);
    setDraggingPdfColumnId(null);
    setDragOverPdfColumnId(null);
  }

  function handlePdfColumnTouchStart(
    event: PointerEvent<HTMLButtonElement>,
    columnId: PdfTableColumnConfig["id"],
  ) {
    if (event.pointerType !== "touch") {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingPdfColumnId(columnId);
    setDragOverPdfColumnId(columnId);
  }

  function handlePdfColumnTouchMove(event: PointerEvent<HTMLButtonElement>) {
    if (event.pointerType !== "touch" || !draggingPdfColumnId) {
      return;
    }

    const hoveredElement = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-pdf-column-id]");
    const targetId = hoveredElement?.dataset.pdfColumnId as
      | PdfTableColumnConfig["id"]
      | undefined;
    if (!targetId || targetId === draggingPdfColumnId) {
      return;
    }

    reorderPdfColumnsByDrag(draggingPdfColumnId, targetId);
    setDraggingPdfColumnId(targetId);
    setDragOverPdfColumnId(targetId);
  }

  function handlePdfColumnTouchEnd(event: PointerEvent<HTMLButtonElement>) {
    if (event.pointerType !== "touch") {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDraggingPdfColumnId(null);
    setDragOverPdfColumnId(null);
  }

  function resetPdfColumns() {
    setSettings((prev) => ({
      ...prev,
      pdfTableColumns: getDefaultPdfTableColumns(),
    }));
  }

  function applyInvoiceDuePreset(preset: InvoiceDuePreset) {
    setInvoiceDuePreset(preset);
    if (preset === "immediate") {
      setCustomInvoiceDueDays("");
      setSettings((prev) => ({ ...prev, invoicePaymentDueDays: 0 }));
      return;
    }
    if (preset === "seven") {
      setCustomInvoiceDueDays("");
      setSettings((prev) => ({ ...prev, invoicePaymentDueDays: 7 }));
      return;
    }
    if (preset === "fourteen") {
      setCustomInvoiceDueDays("");
      setSettings((prev) => ({ ...prev, invoicePaymentDueDays: 14 }));
      return;
    }
  }

  function handleCustomInvoiceDueDaysInput(rawValue: string) {
    const sanitized = rawValue.replace(/[^\d]/g, "");
    setCustomInvoiceDueDays(sanitized);

    if (!sanitized) {
      setInvoiceDuePreset("fourteen");
      setSettings((prev) => ({ ...prev, invoicePaymentDueDays: 14 }));
      return;
    }

    setInvoiceDuePreset("custom");
    const parsed = Number(sanitized);
    const normalized = Number.isFinite(parsed)
      ? Math.min(365, Math.max(0, Math.floor(parsed)))
      : 14;
    setSettings((prev) => ({ ...prev, invoicePaymentDueDays: normalized }));
  }

  async function onLogoUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () =>
        reject(new Error("Datei konnte nicht gelesen werden."));
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
        body: JSON.stringify(settings),
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
          <div className="topBarBrand settingsTopBarBrand">
            <span className="pill settingsLogoPill" aria-label="Visioro">
              V
            </span>
            <strong className="settingsTopBarTitle">Firmeneinstellungen</strong>
          </div>
          <Link href="/" className="ghostButton topBarButton">
            Zur Angebotserstellung
          </Link>
        </header>

        <section className="hero glassCard compactHero">
          <p className="heroEyebrow">Einmal einrichten</p>
          <h1>Diese Daten erscheinen auf jedem Angebot</h1>
          <p className="heroText">
            Dein Logo sowie deine Kontakt- und Firmendaten werden automatisch in
            PDF und Mail-Entwurf übernommen.
          </p>
        </section>

        <section className="glassCard formCard">
          <form onSubmit={onSubmit} className="formGrid">
            <label className="field">
              <span>Firmenname</span>
              <input
                required
                value={settings.companyName}
                autoCapitalize="words"
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    companyName: e.target.value,
                  }))
                }
              />
            </label>

            <label className="field">
              <span>Ansprechpartner</span>
              <input
                required
                value={settings.ownerName}
                autoCapitalize="words"
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    ownerName: e.target.value,
                  }))
                }
              />
            </label>

            <label className="field span2">
              <span>Firmenadresse</span>
              <input
                required
                value={settings.companyStreet}
                autoCapitalize="words"
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    companyStreet: e.target.value,
                  }))
                }
              />
            </label>

            <label className="field">
              <span>PLZ</span>
              <input
                required
                value={settings.companyPostalCode}
                inputMode="numeric"
                pattern="[0-9]*"
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    companyPostalCode: e.target.value,
                  }))
                }
              />
            </label>

            <label className="field">
              <span>Ort</span>
              <input
                required
                value={settings.companyCity}
                autoCapitalize="words"
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    companyCity: e.target.value,
                  }))
                }
              />
            </label>

            <label className="field">
              <span>Firmen-E-Mail</span>
              <input
                required
                type="email"
                autoCapitalize="none"
                autoCorrect="off"
                value={settings.companyEmail}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    companyEmail: e.target.value,
                  }))
                }
              />
            </label>

            <label className="field">
              <span>Telefon</span>
              <input
                type="tel"
                autoComplete="tel"
                value={settings.companyPhone}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    companyPhone: e.target.value,
                  }))
                }
              />
            </label>

            <label className="field">
              <span>Website</span>
              <input
                type="url"
                autoCapitalize="none"
                autoCorrect="off"
                value={settings.companyWebsite}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    companyWebsite: e.target.value,
                  }))
                }
              />
            </label>

            <label className="field span2">
              <span>Interne Kopie per E-Mail (optional)</span>
              <input
                type="email"
                autoCapitalize="none"
                autoCorrect="off"
                value={settings.senderCopyEmail}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    senderCopyEmail: e.target.value,
                  }))
                }
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
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    vatRate: Number(e.target.value),
                  }))
                }
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
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    offerValidityDays: Number(e.target.value),
                  }))
                }
              />
            </label>

            <div className="field span2 settingsInvoiceDueField">
              <span>Zahlungsfrist für Rechnungen</span>
              <div className="settingsInvoiceDuePanel">
                <p className="settingsInvoiceDueHint">
                  Lege fest, welches Zahlungsziel standardmäßig in Rechnungen
                  verwendet wird.
                </p>
                <div className="settingsInvoiceDueOptions" role="radiogroup" aria-label="Zahlungsfrist auswählen">
                  <label className="settingsInvoiceDueOption">
                    <input
                      type="radio"
                      name="invoiceDuePreset"
                      checked={invoiceDuePreset === "immediate"}
                      onChange={() => applyInvoiceDuePreset("immediate")}
                    />
                    <span>Sofort fällig</span>
                  </label>
                  <label className="settingsInvoiceDueOption">
                    <input
                      type="radio"
                      name="invoiceDuePreset"
                      checked={invoiceDuePreset === "seven"}
                      onChange={() => applyInvoiceDuePreset("seven")}
                    />
                    <span>7 Tage</span>
                  </label>
                  <label className="settingsInvoiceDueOption">
                    <input
                      type="radio"
                      name="invoiceDuePreset"
                      checked={invoiceDuePreset === "fourteen"}
                      onChange={() => applyInvoiceDuePreset("fourteen")}
                    />
                    <span>14 Tage</span>
                  </label>
                </div>
                <label className="settingsInvoiceDueCustom">
                  <span>Eigene Frist</span>
                  <div className="settingsInvoiceDueCustomInputWrap">
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={customInvoiceDueDays}
                      onChange={(event) =>
                        handleCustomInvoiceDueDaysInput(event.target.value)
                      }
                      placeholder="z. B. 30"
                    />
                    <em>Tage</em>
                  </div>
                </label>
              </div>
            </div>

            <label className="field">
              <span>Letzte Angebotsnummer</span>
              <input
                value={settings.lastOfferNumber}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    lastOfferNumber: e.target.value,
                  }))
                }
                placeholder="z. B. ANG-2026-025"
              />
            </label>

            <label className="field span2">
              <span>Hinweis / Bedingungen im PDF</span>
              <textarea
                rows={4}
                value={settings.offerTermsText}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    offerTermsText: e.target.value,
                  }))
                }
                placeholder="z. B. Zahlungsbedingungen oder Angebotsbedingungen"
              />
            </label>

            <div className="field span2 settingsPdfColumnsField">
              <span>PDF-Tabellenspalten</span>
              <div className="settingsPdfColumnsPanel">
                <p className="settingsPdfColumnsHint">
                  Lege fest, welche Spalten im Angebots-PDF sichtbar sind und in
                  welcher Reihenfolge sie erscheinen.
                </p>
                <div className="settingsPdfColumnsList">
                  {orderedPdfColumns.map((column) => {
                    const isDragTarget =
                      draggingPdfColumnId !== null &&
                      dragOverPdfColumnId === column.id;

                    return (
                      <div
                        key={column.id}
                        className={`settingsPdfColumnsRow ${isDragTarget ? "settingsPdfColumnsRowDragTarget" : ""}`}
                        data-pdf-column-id={column.id}
                        onDragOver={(event) =>
                          handlePdfColumnDragOver(event, column.id)
                        }
                        onDrop={(event) =>
                          handlePdfColumnDrop(event, column.id)
                        }
                      >
                        <button
                          type="button"
                          className="settingsPdfColumnsDragHandle"
                          draggable
                          onDragStart={(event) =>
                            handlePdfColumnDragStart(event, column.id)
                          }
                          onDragEnd={() => {
                            setDraggingPdfColumnId(null);
                            setDragOverPdfColumnId(null);
                          }}
                          onPointerDown={(event) =>
                            handlePdfColumnTouchStart(event, column.id)
                          }
                          onPointerMove={handlePdfColumnTouchMove}
                          onPointerUp={handlePdfColumnTouchEnd}
                          onPointerCancel={handlePdfColumnTouchEnd}
                          aria-label={`${column.label} per Drag-and-Drop verschieben`}
                        >
                          ⋮⋮
                        </button>

                        <label className="settingsPdfColumnsToggle">
                          <input
                            type="checkbox"
                            checked={column.visible}
                            onChange={(event) =>
                              togglePdfColumnVisibility(
                                column.id,
                                event.target.checked,
                              )
                            }
                          />
                          <span>Sichtbar</span>
                        </label>

                        <input
                          value={column.label}
                          onChange={(event) =>
                            updatePdfColumnLabel(column.id, event.target.value)
                          }
                          placeholder="Spaltenname"
                        />
                      </div>
                    );
                  })}
                </div>

                <button
                  type="button"
                  className="ghostButton settingsPdfColumnsReset"
                  onClick={resetPdfColumns}
                >
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
                <img
                  src={settings.logoDataUrl}
                  alt="Logo Vorschau"
                  className="logoPreview"
                />
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
