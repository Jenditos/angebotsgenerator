"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  ChangeEvent,
  DragEvent,
  FormEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  LOGO_ALLOWED_FORMATS_LABEL,
  LOGO_UPLOAD_ACCEPT_ATTRIBUTE,
  MAX_LOGO_DATA_URL_LENGTH,
  MAX_LOGO_RENDER_EDGE_PX,
  MAX_LOGO_UPLOAD_FILE_BYTES,
  MAX_LOGO_UPLOAD_FILE_MB,
  hasSupportedLogoExtension,
  isSupportedLogoMimeType,
  sanitizeCompanyLogoDataUrl,
} from "@/lib/logo-config";
import { getDefaultPdfTableColumns } from "@/lib/pdf-table-config";
import { getSupabaseBrowserClient } from "@/lib/supabaseClient";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { VisioroLogoPill } from "@/components/VisioroLogoPill";
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
  taxNumber: "",
  vatId: "",
  companyCountry: "",
  euVatNoticeText: "",
  includeCustomerVatId: false,
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
  lastInvoiceNumber: "",
  customServiceTypes: [],
};

const SETTINGS_DRAFT_STORAGE_KEY = "visioro-settings-draft-v1";
const SETTINGS_AUTOSAVE_DELAY_MS = 700;
const LOGO_DOWNSCALE_FACTOR = 0.82;
const LOGO_MAX_DOWNSCALE_ATTEMPTS = 6;
const LOGO_JPEG_QUALITIES = [0.92, 0.86, 0.8, 0.74, 0.68];

function sortPdfColumns(
  columns: PdfTableColumnConfig[],
): PdfTableColumnConfig[] {
  return [...columns].sort((a, b) => a.order - b.order);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function validateWebsiteInput(rawValue: string): {
  isValid: boolean;
  normalized: string;
} {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return { isValid: true, normalized: "" };
  }

  if (/\s/.test(trimmed)) {
    return { isValid: false, normalized: trimmed };
  }

  const hasScheme = /^https?:\/\//i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { isValid: false, normalized: trimmed };
    }

    const host = parsed.hostname.trim().toLowerCase();
    const isIpv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
    const isDomainLike = host.includes(".") || host === "localhost" || isIpv4;
    if (!isDomainLike) {
      return { isValid: false, normalized: trimmed };
    }

    return { isValid: true, normalized: trimmed };
  } catch {
    return { isValid: false, normalized: trimmed };
  }
}

function isSupportedLogoFile(file: File): boolean {
  if (isSupportedLogoMimeType(file.type)) {
    return true;
  }

  return hasSupportedLogoExtension(file.name);
}

function scaleToMaxEdge(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const largestEdge = Math.max(width, height);
  if (largestEdge <= maxEdge) {
    return { width, height };
  }

  const scale = maxEdge / largestEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function serializeCanvasWithinLimit(
  canvas: HTMLCanvasElement,
  maxDataUrlLength: number,
): string | null {
  try {
    const pngDataUrl = canvas.toDataURL("image/png");
    if (pngDataUrl.length <= maxDataUrlLength) {
      return pngDataUrl;
    }
  } catch {
    // Try JPEG fallback below.
  }

  for (const quality of LOGO_JPEG_QUALITIES) {
    try {
      const jpegDataUrl = canvas.toDataURL("image/jpeg", quality);
      if (jpegDataUrl.length <= maxDataUrlLength) {
        return jpegDataUrl;
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function loadImageElementFromFile(file: File): Promise<HTMLImageElement> {
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("logo-image-load-failed"));
    };

    image.src = objectUrl;
  });
}

async function convertLogoFileToDataUrl(file: File): Promise<string> {
  const image = await loadImageElementFromFile(file);
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;

  if (naturalWidth <= 0 || naturalHeight <= 0) {
    throw new Error("logo-image-invalid");
  }

  const initialSize = scaleToMaxEdge(
    naturalWidth,
    naturalHeight,
    MAX_LOGO_RENDER_EDGE_PX,
  );
  let canvas = document.createElement("canvas");
  canvas.width = initialSize.width;
  canvas.height = initialSize.height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("logo-canvas-unavailable");
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  const firstAttempt = serializeCanvasWithinLimit(canvas, MAX_LOGO_DATA_URL_LENGTH);
  if (firstAttempt) {
    return firstAttempt;
  }

  for (let attempt = 0; attempt < LOGO_MAX_DOWNSCALE_ATTEMPTS; attempt += 1) {
    const resizedCanvas = document.createElement("canvas");
    resizedCanvas.width = Math.max(
      1,
      Math.round(canvas.width * LOGO_DOWNSCALE_FACTOR),
    );
    resizedCanvas.height = Math.max(
      1,
      Math.round(canvas.height * LOGO_DOWNSCALE_FACTOR),
    );

    const resizedCtx = resizedCanvas.getContext("2d");
    if (!resizedCtx) {
      throw new Error("logo-canvas-unavailable");
    }
    resizedCtx.clearRect(0, 0, resizedCanvas.width, resizedCanvas.height);
    resizedCtx.drawImage(canvas, 0, 0, resizedCanvas.width, resizedCanvas.height);
    canvas = resizedCanvas;

    const candidate = serializeCanvasWithinLimit(
      canvas,
      MAX_LOGO_DATA_URL_LENGTH,
    );
    if (candidate) {
      return candidate;
    }
  }

  throw new Error("logo-too-large-after-optimization");
}

function normalizeSettingsDraft(input: unknown): CompanySettings | null {
  if (!isRecord(input)) {
    return null;
  }

  const pdfTableColumns = Array.isArray(input.pdfTableColumns)
    ? (input.pdfTableColumns as PdfTableColumnConfig[])
    : getDefaultPdfTableColumns();

  return {
    companyName: asString(input.companyName),
    ownerName: asString(input.ownerName),
    companyStreet: asString(input.companyStreet),
    companyPostalCode: asString(input.companyPostalCode),
    companyCity: asString(input.companyCity),
    companyEmail: asString(input.companyEmail),
    companyPhone: asString(input.companyPhone),
    companyWebsite: asString(input.companyWebsite),
    taxNumber: asString(input.taxNumber),
    vatId: asString(input.vatId),
    companyCountry: asString(input.companyCountry, emptySettings.companyCountry),
    euVatNoticeText: asString(input.euVatNoticeText),
    includeCustomerVatId: asBoolean(
      input.includeCustomerVatId,
      emptySettings.includeCustomerVatId,
    ),
    senderCopyEmail: asString(input.senderCopyEmail),
    logoDataUrl: sanitizeCompanyLogoDataUrl(asString(input.logoDataUrl)),
    pdfTableColumns,
    customServices: Array.isArray(input.customServices)
      ? (input.customServices as CompanySettings["customServices"])
      : [],
    vatRate: asNumber(input.vatRate, emptySettings.vatRate),
    offerValidityDays: asNumber(
      input.offerValidityDays,
      emptySettings.offerValidityDays,
    ),
    invoicePaymentDueDays: asNumber(
      input.invoicePaymentDueDays,
      emptySettings.invoicePaymentDueDays,
    ),
    offerTermsText: asString(input.offerTermsText, emptySettings.offerTermsText),
    lastOfferNumber: asString(input.lastOfferNumber),
    lastInvoiceNumber: asString(input.lastInvoiceNumber),
    customServiceTypes: Array.isArray(input.customServiceTypes)
      ? input.customServiceTypes
          .map((entry) => String(entry).trim())
          .filter(Boolean)
      : [],
  };
}

function readSettingsDraftFromSessionStorage(): CompanySettings | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(SETTINGS_DRAFT_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as unknown;
    if (isRecord(parsed) && isRecord(parsed.settings)) {
      return normalizeSettingsDraft(parsed.settings);
    }

    return normalizeSettingsDraft(parsed);
  } catch {
    return null;
  }
}

function writeSettingsDraftToSessionStorage(nextSettings: CompanySettings) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(
    SETTINGS_DRAFT_STORAGE_KEY,
    JSON.stringify({
      updatedAt: new Date().toISOString(),
      settings: nextSettings,
    }),
  );
}

function areSettingsEqual(left: CompanySettings, right: CompanySettings): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

type InvoiceDuePreset = "immediate" | "seven" | "fourteen" | "custom";
type PdfColumnDropPosition = "before" | "after";

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
  const router = useRouter();
  const searchParams = useSearchParams();
  const isEmbedded = searchParams.get("embedded") === "1";
  const [settings, setSettings] = useState<CompanySettings>(emptySettings);
  const [saveStatus, setSaveStatus] = useState("");
  const [error, setError] = useState("");
  const [isSettingsHydrated, setIsSettingsHydrated] = useState(false);
  const [isAutosaveEnabled, setIsAutosaveEnabled] = useState(false);
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
  const [dragOverPdfColumnPosition, setDragOverPdfColumnPosition] =
    useState<PdfColumnDropPosition>("after");
  const [isLeavingSettings, setIsLeavingSettings] = useState(false);
  const [logoPreviewRevision, setLogoPreviewRevision] = useState(0);
  const leaveSettingsTimeoutRef = useRef<number | null>(null);
  const autosaveTimeoutRef = useRef<number | null>(null);
  const settingsSaveRequestRef = useRef(0);
  const settingsSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const hasLocalLogoChangeRef = useRef(false);
  const isNotLoggedInError = /^nicht eingeloggt\.?$/i.test(error.trim());

  const persistSettings = useCallback(
    async (
      nextSettings: CompanySettings,
      mode: "manual" | "autosave" | "reset" = "manual",
    ) => {
      const requestId = ++settingsSaveRequestRef.current;
      const runPersist = async (): Promise<boolean> => {
        if (mode === "manual") {
          setSaveStatus("");
          setError("");
        } else if (mode === "reset") {
          setError("");
        }

        const websiteValidation = validateWebsiteInput(nextSettings.companyWebsite);
        if (!websiteValidation.isValid) {
          if (mode !== "autosave") {
            setSaveStatus("");
            setError("Bitte geben Sie eine gültige URL ein.");
            return false;
          }
        }

        const payloadSettings: CompanySettings = {
          ...nextSettings,
          companyWebsite: websiteValidation.isValid
            ? websiteValidation.normalized
            : nextSettings.companyWebsite.trim(),
        };

        try {
          const response = await fetch("/api/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payloadSettings),
          });

          const data = await response.json();
          if (!response.ok) {
            if (
              settingsSaveRequestRef.current === requestId &&
              mode !== "autosave"
            ) {
              setError(data.error ?? "Speichern fehlgeschlagen");
            }
            return false;
          }

          if (settingsSaveRequestRef.current !== requestId) {
            return false;
          }

          const resolvedSettings = data.settings as CompanySettings;
          setSettings((prev) =>
            areSettingsEqual(prev, resolvedSettings) ? prev : resolvedSettings,
          );
          writeSettingsDraftToSessionStorage(resolvedSettings);
          setIsAutosaveEnabled(true);
          setError("");
          if (resolvedSettings.logoDataUrl === payloadSettings.logoDataUrl) {
            hasLocalLogoChangeRef.current = false;
          }

          if (mode === "manual") {
            setSaveStatus("Einstellungen wurden gespeichert.");
          } else if (mode === "reset") {
            setSaveStatus("Einstellungen wurden zurückgesetzt.");
          }

          return true;
        } catch {
          if (
            settingsSaveRequestRef.current === requestId &&
            mode !== "autosave"
          ) {
            setError("Netzwerkfehler beim Speichern.");
          }
          return false;
        }
      };

      const queuedPersistPromise = settingsSaveQueueRef.current.then(
        runPersist,
        runPersist,
      );
      settingsSaveQueueRef.current = queuedPersistPromise
        .then(() => undefined)
        .catch(() => undefined);
      return queuedPersistPromise;
    },
    [],
  );

  useEffect(() => {
    let mounted = true;
    const draftSettings = readSettingsDraftFromSessionStorage();

    if (draftSettings) {
      setSettings(draftSettings);
      setIsSettingsHydrated(true);
    }

    async function loadSettings() {
      try {
        const response = await fetch("/api/settings");
        const data = await response.json();
        if (!mounted) {
          return;
        }

        if (!response.ok) {
          if (!draftSettings) {
            setError(data.error ?? "Einstellungen konnten nicht geladen werden.");
          } else {
            setIsAutosaveEnabled(true);
          }
          return;
        }

        const loadedSettings = data.settings as CompanySettings;
        if (draftSettings) {
          setSettings((prev) => {
            const mergedSettings: CompanySettings = {
              ...prev,
              logoDataUrl: hasLocalLogoChangeRef.current
                ? prev.logoDataUrl
                : loadedSettings.logoDataUrl,
            };
            writeSettingsDraftToSessionStorage(mergedSettings);
            return mergedSettings;
          });
        } else if (hasLocalLogoChangeRef.current) {
          setSettings((prev) => {
            const mergedSettings: CompanySettings = {
              ...loadedSettings,
              logoDataUrl: prev.logoDataUrl,
            };
            writeSettingsDraftToSessionStorage(mergedSettings);
            return mergedSettings;
          });
        } else {
          setSettings(loadedSettings);
          writeSettingsDraftToSessionStorage(loadedSettings);
        }
        setIsAutosaveEnabled(true);
        setError("");
      } catch {
        if (mounted) {
          if (!draftSettings) {
            setError("Einstellungen konnten nicht geladen werden.");
          } else {
            setIsAutosaveEnabled(true);
          }
        }
      } finally {
        if (mounted) {
          setIsSettingsHydrated(true);
        }
      }
    }

    void loadSettings();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isSettingsHydrated || !isAutosaveEnabled) {
      return;
    }

    writeSettingsDraftToSessionStorage(settings);
    if (autosaveTimeoutRef.current !== null) {
      window.clearTimeout(autosaveTimeoutRef.current);
    }

    autosaveTimeoutRef.current = window.setTimeout(() => {
      void persistSettings(settings, "autosave");
    }, SETTINGS_AUTOSAVE_DELAY_MS);

    return () => {
      if (autosaveTimeoutRef.current !== null) {
        window.clearTimeout(autosaveTimeoutRef.current);
        autosaveTimeoutRef.current = null;
      }
    };
  }, [isAutosaveEnabled, isSettingsHydrated, persistSettings, settings]);

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
    position: PdfColumnDropPosition = "after",
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
      let insertIndex = position === "before" ? targetIndex : targetIndex + 1;
      if (sourceIndex < insertIndex) {
        insertIndex -= 1;
      }
      const boundedInsertIndex = Math.max(
        0,
        Math.min(nextSorted.length, insertIndex),
      );
      nextSorted.splice(boundedInsertIndex, 0, movedColumn);

      return nextSorted.map((column, index) => ({
        ...column,
        order: index,
      }));
    });
  }

  function resolveDropPosition(
    clientY: number,
    targetRect: DOMRect,
  ): PdfColumnDropPosition {
    return clientY <= targetRect.top + targetRect.height / 2
      ? "before"
      : "after";
  }

  function handlePdfColumnDragStart(
    event: DragEvent<HTMLButtonElement>,
    columnId: PdfTableColumnConfig["id"],
  ) {
    setDraggingPdfColumnId(columnId);
    setDragOverPdfColumnId(columnId);
    setDragOverPdfColumnPosition("after");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", columnId);
  }

  function handlePdfColumnDragOver(
    event: DragEvent<HTMLDivElement>,
    targetId: PdfTableColumnConfig["id"],
  ) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const dropPosition = resolveDropPosition(
      event.clientY,
      event.currentTarget.getBoundingClientRect(),
    );
    setDragOverPdfColumnId(targetId);
    setDragOverPdfColumnPosition(dropPosition);
  }

  function handlePdfColumnDrop(
    event: DragEvent<HTMLDivElement>,
    targetId: PdfTableColumnConfig["id"],
  ) {
    event.preventDefault();
    if (!draggingPdfColumnId) {
      return;
    }
    reorderPdfColumnsByDrag(
      draggingPdfColumnId,
      targetId,
      dragOverPdfColumnPosition,
    );
    setDraggingPdfColumnId(null);
    setDragOverPdfColumnId(null);
    setDragOverPdfColumnPosition("after");
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
    setDragOverPdfColumnPosition("after");
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
    if (!hoveredElement || !targetId) {
      return;
    }

    const dropPosition = resolveDropPosition(
      event.clientY,
      hoveredElement.getBoundingClientRect(),
    );
    setDragOverPdfColumnId(targetId);
    setDragOverPdfColumnPosition(dropPosition);
  }

  function handlePdfColumnTouchEnd(event: PointerEvent<HTMLButtonElement>) {
    if (event.pointerType !== "touch") {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (
      draggingPdfColumnId &&
      dragOverPdfColumnId &&
      draggingPdfColumnId !== dragOverPdfColumnId
    ) {
      reorderPdfColumnsByDrag(
        draggingPdfColumnId,
        dragOverPdfColumnId,
        dragOverPdfColumnPosition,
      );
    }
    setDraggingPdfColumnId(null);
    setDragOverPdfColumnId(null);
    setDragOverPdfColumnPosition("after");
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
    const inputElement = event.currentTarget;
    const file = inputElement.files?.[0];
    if (!file) {
      return;
    }

    setSaveStatus("");
    setError("");

    if (!isSupportedLogoFile(file)) {
      setError(
        `Dieses Format wird nicht unterstützt. Erlaubt sind ${LOGO_ALLOWED_FORMATS_LABEL}.`,
      );
      inputElement.value = "";
      return;
    }

    if (file.size > MAX_LOGO_UPLOAD_FILE_BYTES) {
      setError(
        `Die Datei ist zu groß. Maximal ${MAX_LOGO_UPLOAD_FILE_MB} MB sind erlaubt.`,
      );
      inputElement.value = "";
      return;
    }

    try {
      const dataUrl = await convertLogoFileToDataUrl(file);

      const nextSettings: CompanySettings = {
        ...settings,
        logoDataUrl: dataUrl,
      };
      hasLocalLogoChangeRef.current = true;
      setSettings(nextSettings);
      writeSettingsDraftToSessionStorage(nextSettings);
      setIsAutosaveEnabled(true);
      setLogoPreviewRevision((prev) => prev + 1);
      if (autosaveTimeoutRef.current !== null) {
        window.clearTimeout(autosaveTimeoutRef.current);
        autosaveTimeoutRef.current = null;
      }
      void persistSettings(nextSettings, "autosave");
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "logo-too-large-after-optimization"
      ) {
        setError(
          "Das Logo ist trotz automatischer Optimierung zu groß. Bitte eine kleinere Datei wählen.",
        );
      } else {
        setError(
          "Das Logo konnte nicht verarbeitet werden. Bitte PNG, JPG, JPEG, WEBP oder SVG verwenden.",
        );
      }
    } finally {
      inputElement.value = "";
    }
  }

  function deleteLogo() {
    if (!settings.logoDataUrl) {
      return;
    }

    const confirmed = window.confirm(
      "Möchten Sie das Firmenlogo wirklich löschen?",
    );
    if (!confirmed) {
      return;
    }

    const nextSettings: CompanySettings = {
      ...settings,
      logoDataUrl: "",
    };
    hasLocalLogoChangeRef.current = true;
    setSettings(nextSettings);
    writeSettingsDraftToSessionStorage(nextSettings);
    setIsAutosaveEnabled(true);
    setLogoPreviewRevision((prev) => prev + 1);
    setSaveStatus("");
    setError("");
    if (autosaveTimeoutRef.current !== null) {
      window.clearTimeout(autosaveTimeoutRef.current);
      autosaveTimeoutRef.current = null;
    }
    void persistSettings(nextSettings, "autosave");
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await persistSettings(settings, "manual");
  }

  function resetSettings() {
    const confirmed = window.confirm(
      "Möchten Sie wirklich alle Einstellungen löschen?",
    );
    if (!confirmed) {
      return;
    }

    const resetTarget: CompanySettings = {
      ...emptySettings,
      pdfTableColumns: getDefaultPdfTableColumns(),
      customServices: [],
      customServiceTypes: [],
    };

    setSettings(resetTarget);
    setInvoiceDuePreset(toInvoiceDuePreset(resetTarget.invoicePaymentDueDays));
    setCustomInvoiceDueDays("");
    setError("");
    setSaveStatus("");
    writeSettingsDraftToSessionStorage(resetTarget);
    void persistSettings(resetTarget, "reset");
  }

  function handleBackNavigation(event: ReactMouseEvent<HTMLAnchorElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    event.preventDefault();
    if (isLeavingSettings) {
      return;
    }

    setIsLeavingSettings(true);
    writeSettingsDraftToSessionStorage(settings);
    if (leaveSettingsTimeoutRef.current !== null) {
      window.clearTimeout(leaveSettingsTimeoutRef.current);
    }
    leaveSettingsTimeoutRef.current = window.setTimeout(() => {
      router.push("/");
    }, 140);
  }

  async function handleLogout() {
    try {
      if (isSupabaseConfigured()) {
        const supabase = getSupabaseBrowserClient();
        await supabase.auth.signOut();
      }
    } finally {
      router.replace("/auth");
    }
  }

  useEffect(() => {
    return () => {
      if (leaveSettingsTimeoutRef.current !== null) {
        window.clearTimeout(leaveSettingsTimeoutRef.current);
      }
      if (autosaveTimeoutRef.current !== null) {
        window.clearTimeout(autosaveTimeoutRef.current);
      }
    };
  }, []);

  return (
    <main className={`page ${isEmbedded ? "settingsEmbeddedPage" : ""}`}>
      {!isEmbedded ? <div className="ambient ambientA" aria-hidden /> : null}
      {!isEmbedded ? <div className="ambient ambientB" aria-hidden /> : null}
      <div
        className={`container settingsPageTransition ${
          isLeavingSettings ? "closing" : ""
        } ${isEmbedded ? "settingsEmbeddedContainer" : ""}`}
      >
        {!isEmbedded ? (
          <header className="topHeaderMinimal">
            <VisioroLogoPill />
            <Link
              href="/"
              className={`topHeaderSettingsButton topHeaderBackButton ${isLeavingSettings ? "isNavigating" : ""}`}
              aria-label="Zurück"
              title="Zurück"
              onClick={handleBackNavigation}
            >
              <svg
                viewBox="0 0 24 24"
                className="topHeaderIcon"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  d="M15.5 5.5 8.5 12l7 6.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
            <button
              type="button"
              className="topHeaderSettingsButton topHeaderArchiveButton"
              onClick={() => void handleLogout()}
              aria-label="Logout"
              title="Logout"
            >
              <svg
                viewBox="0 0 24 24"
                className="topHeaderIcon"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  d="M15 7.5V6.2a2.2 2.2 0 0 0-2.2-2.2H7.2A2.2 2.2 0 0 0 5 6.2v11.6A2.2 2.2 0 0 0 7.2 20h5.6A2.2 2.2 0 0 0 15 17.8v-1.3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M10.5 12h8m-2.7-2.7L18.5 12l-2.7 2.7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </header>
        ) : null}

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
                type="text"
                inputMode="url"
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

            <label className="field">
              <span>Steuernummer</span>
              <input
                value={settings.taxNumber}
                autoCapitalize="characters"
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    taxNumber: e.target.value,
                  }))
                }
                placeholder="z. B. 12/345/67890"
              />
            </label>

            <label className="field">
              <span>USt-IdNr.</span>
              <input
                value={settings.vatId}
                autoCapitalize="characters"
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    vatId: e.target.value,
                  }))
                }
                placeholder="z. B. DE123456789"
              />
            </label>

            <label className="field span2">
              <span>Standard-Land / Unternehmenssitz</span>
              <input
                value={settings.companyCountry}
                autoCapitalize="words"
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    companyCountry: e.target.value,
                  }))
                }
                placeholder="z. B. Deutschland"
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

            <label className="field span2">
              <span>Steuerhinweis für EU-/Auslandsfälle (optional)</span>
              <textarea
                rows={3}
                value={settings.euVatNoticeText}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    euVatNoticeText: e.target.value,
                  }))
                }
                placeholder="z. B. Reverse-Charge-Hinweis oder Hinweis zur Steuerbefreiung"
              />
            </label>

            <div className="field span2 settingsTaxOptionsField">
              <span>Dokumentenoptionen (Vorbereitung)</span>
              <label className="settingsTaxOptionToggle">
                <input
                  type="checkbox"
                  checked={settings.includeCustomerVatId}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      includeCustomerVatId: e.target.checked,
                    }))
                  }
                />
                <span>
                  Kunden-USt-IdNr. auf Dokumenten berücksichtigen (für
                  EU-/Auslandsfälle)
                </span>
              </label>
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

            <label className="field">
              <span>Letzte Rechnungsnummer</span>
              <input
                value={settings.lastInvoiceNumber}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    lastInvoiceNumber: e.target.value,
                  }))
                }
                placeholder="z. B. RE-2026-025"
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
                    const isDraggingRow = draggingPdfColumnId === column.id;
                    const isDragTarget =
                      draggingPdfColumnId !== null &&
                      dragOverPdfColumnId === column.id &&
                      !isDraggingRow;
                    const isDropBefore =
                      isDragTarget && dragOverPdfColumnPosition === "before";
                    const isDropAfter =
                      isDragTarget && dragOverPdfColumnPosition === "after";

                    return (
                      <div
                        key={column.id}
                        className={`settingsPdfColumnsRow ${isDraggingRow ? "settingsPdfColumnsRowDragging" : ""} ${isDragTarget ? "settingsPdfColumnsRowDragTarget" : ""} ${isDropBefore ? "settingsPdfColumnsRowDropBefore" : ""} ${isDropAfter ? "settingsPdfColumnsRowDropAfter" : ""}`}
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
                          className={`settingsPdfColumnsDragHandle ${isDraggingRow ? "settingsPdfColumnsDragHandleDragging" : ""}`}
                          draggable
                          onDragStart={(event) =>
                            handlePdfColumnDragStart(event, column.id)
                          }
                          onDragEnd={() => {
                            setDraggingPdfColumnId(null);
                            setDragOverPdfColumnId(null);
                            setDragOverPdfColumnPosition("after");
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
              <input
                type="file"
                accept={LOGO_UPLOAD_ACCEPT_ATTRIBUTE}
                onChange={onLogoUpload}
              />
            </label>

            <p className="settingsLogoHint span2">
              Erlaubte Formate: {LOGO_ALLOWED_FORMATS_LABEL}. Maximal{" "}
              {MAX_LOGO_UPLOAD_FILE_MB} MB pro Datei. Große Logos werden
              automatisch passend verkleinert, damit Vorschau und PDF sauber
              bleiben.
            </p>

            <div className="settingsLogoActions span2">
              <button
                type="button"
                className="ghostButton settingsLogoDeleteButton"
                onClick={deleteLogo}
                disabled={!settings.logoDataUrl}
              >
                Logo löschen
              </button>
            </div>

            {settings.logoDataUrl ? (
              <div className="logoFrame span2">
                <img
                  key={logoPreviewRevision}
                  src={settings.logoDataUrl}
                  alt="Logo Vorschau"
                  className="logoPreview"
                />
              </div>
            ) : null}

            <button type="submit" className="primaryButton submitButton">
              Einstellungen speichern
            </button>
            <button
              type="button"
              className="ghostButton settingsDeleteButton"
              onClick={resetSettings}
            >
              Einstellungen löschen
            </button>
          </form>
          {saveStatus ? <p className="success">{saveStatus}</p> : null}
          {error ? (
            <p className={isNotLoggedInError ? "voiceInfo postActionError" : "error"}>
              {error}
            </p>
          ) : null}
        </section>
      </div>
    </main>
  );
}
