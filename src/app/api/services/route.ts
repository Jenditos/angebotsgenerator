import { NextResponse } from "next/server";
import { requireAppAccess } from "@/lib/access/guards";
import {
  buildServiceCatalog,
  createCustomService,
  DEFAULT_CUSTOM_SERVICE_CATEGORY,
  normalizeSearchValue,
  sanitizeCustomServices,
  searchServices
} from "@/lib/service-catalog";
import { readSettings, writeSettings } from "@/lib/settings-store";

const MIN_SERVICE_LABEL_LENGTH = 2;

export async function GET(request: Request) {
  const accessResult = await requireAppAccess();
  if (!accessResult.ok) {
    return accessResult.response;
  }

  try {
    const settings = await readSettings();
    const catalog = buildServiceCatalog(settings.customServices);

    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q")?.trim() ?? "";
    const limit = Number(searchParams.get("limit") ?? 120);
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 200) : 120;

    const services = query ? searchServices(catalog, query, safeLimit) : catalog.slice(0, safeLimit);

    return NextResponse.json({
      services,
      customServices: settings.customServices
    });
  } catch {
    return NextResponse.json({ error: "Leistungen konnten nicht geladen werden." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const accessResult = await requireAppAccess();
  if (!accessResult.ok) {
    return accessResult.response;
  }

  try {
    const body = (await request.json()) as {
      label?: string;
      category?: string;
    };

    const label = typeof body.label === "string" ? body.label.trim() : "";
    const category = typeof body.category === "string" ? body.category.trim() : DEFAULT_CUSTOM_SERVICE_CATEGORY;

    if (label.length < MIN_SERVICE_LABEL_LENGTH) {
      return NextResponse.json(
        { error: "Bitte gib mindestens zwei Zeichen für die Leistung ein." },
        { status: 400 }
      );
    }

    const settings = await readSettings();
    const currentCustomServices = sanitizeCustomServices(settings.customServices);

    const normalizedLabel = normalizeSearchValue(label);
    const normalizedCategory = normalizeSearchValue(category);

    const existingCustomService = currentCustomServices.find(
      (service) =>
        normalizeSearchValue(service.label) === normalizedLabel &&
        normalizeSearchValue(service.category) === normalizedCategory
    );

    if (existingCustomService) {
      const services = buildServiceCatalog(currentCustomServices);
      return NextResponse.json({
        customService: existingCustomService,
        customServices: currentCustomServices,
        services
      });
    }

    const customService = createCustomService({ label, category });
    const nextCustomServices = sanitizeCustomServices([...currentCustomServices, customService]);
    const updatedSettings = await writeSettings({ customServices: nextCustomServices });

    return NextResponse.json({
      customService,
      customServices: updatedSettings.customServices,
      services: buildServiceCatalog(updatedSettings.customServices)
    });
  } catch {
    return NextResponse.json({ error: "Eigene Leistung konnte nicht gespeichert werden." }, { status: 500 });
  }
}
