import { CustomService, ServiceCatalogItem } from "@/types/offer";

export const DEFAULT_CUSTOM_SERVICE_CATEGORY = "Eigene Leistungen";

type ServiceSeedCategory = {
  category: string;
  services: string[];
};

const HANDWERK_SERVICE_LABELS = Array.from(
  new Set([
    "Abbrucharbeiten",
    "Abdichtungsarbeiten",
    "Anstricharbeiten",
    "Außenputz",
    "Badsanierung",
    "Baustelleneinrichtung",
    "Betonarbeiten",
    "Bodenbelagsarbeiten",
    "Dachabdichtung",
    "Dacharbeiten",
    "Dämmarbeiten",
    "Elektroinstallation",
    "Entwässerungsarbeiten",
    "Erdarbeiten",
    "Estricharbeiten",
    "Fassadenarbeiten",
    "Fenster einbauen",
    "Fliesenarbeiten",
    "Fundamentarbeiten",
    "Garten- und Landschaftsbau",
    "Gerüstbau",
    "Heizungsinstallation",
    "Innenputz",
    "Kabelverlegung",
    "Malerarbeiten",
    "Mauerarbeiten",
    "Pflasterarbeiten",
    "Putzarbeiten",
    "Renovierungsarbeiten",
    "Reparaturarbeiten",
    "Rohbauarbeiten",
    "Sanitärinstallation",
    "Schalungsarbeiten",
    "Schimmelsanierung",
    "Spachtelarbeiten",
    "Straßenbau",
    "Tapezierarbeiten",
    "Trockenbauarbeiten",
    "Wärmedämmung",
    "Wartungsarbeiten",
    "Zaunbau",
    "Zimmererarbeiten",
  ]),
).sort((left, right) => left.localeCompare(right, "de"));

const SERVICE_SEED_CATEGORIES: ServiceSeedCategory[] = [
  {
    category: "Handwerksleistungen",
    services: HANDWERK_SERVICE_LABELS,
  },
];

const MAX_CUSTOM_SERVICES = 500;
const MAX_SERVICE_LABEL_LENGTH = 140;
const MAX_CATEGORY_LENGTH = 80;

function createSlug(value: string): string {
  const normalized = value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "service";
}

export function normalizeSearchValue(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeCategory(category: unknown): string {
  if (typeof category !== "string") {
    return DEFAULT_CUSTOM_SERVICE_CATEGORY;
  }

  const trimmed = category.trim().slice(0, MAX_CATEGORY_LENGTH);
  return trimmed || DEFAULT_CUSTOM_SERVICE_CATEGORY;
}

function normalizeLabel(label: unknown): string {
  if (typeof label !== "string") {
    return "";
  }

  return label.trim().slice(0, MAX_SERVICE_LABEL_LENGTH);
}

function createStableCustomServiceId(label: string, category: string, index: number): string {
  return `custom-${createSlug(category)}-${createSlug(label)}-${index}`;
}

function serviceKey(label: string, category: string): string {
  return `${normalizeSearchValue(label)}::${normalizeSearchValue(category)}`;
}

const SEED_SERVICES: ServiceCatalogItem[] = SERVICE_SEED_CATEGORIES.flatMap(({ category, services }) =>
  services.map((label, index) => ({
    id: `seed-${createSlug(category)}-${createSlug(label)}-${index}`,
    label,
    category,
    source: "seed" as const
  }))
);

export function getSeedServices(): ServiceCatalogItem[] {
  return SEED_SERVICES.map((service) => ({ ...service }));
}

export function sanitizeCustomServices(payload: unknown): CustomService[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  const unique = new Set<string>();
  const sanitized: CustomService[] = [];

  for (const [index, item] of payload.entries()) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const label = normalizeLabel("label" in item ? item.label : "");
    if (!label) {
      continue;
    }

    const category = normalizeCategory("category" in item ? item.category : "");
    const dedupeKey = serviceKey(label, category);
    if (unique.has(dedupeKey)) {
      continue;
    }

    const id =
      "id" in item && typeof item.id === "string" && item.id.trim().length > 0
        ? item.id.trim()
        : createStableCustomServiceId(label, category, index);

    const createdAt =
      "createdAt" in item && typeof item.createdAt === "string" && item.createdAt.trim().length > 0
        ? item.createdAt.trim()
        : new Date(0).toISOString();

    unique.add(dedupeKey);
    sanitized.push({
      id,
      label,
      category,
      createdAt
    });

    if (sanitized.length >= MAX_CUSTOM_SERVICES) {
      break;
    }
  }

  return sanitized.sort((a, b) => a.label.localeCompare(b.label, "de"));
}

export function createCustomService(input: { label: string; category?: string }): CustomService {
  const label = normalizeLabel(input.label);
  const category = normalizeCategory(input.category);
  const randomSuffix = Math.random().toString(36).slice(2, 8);

  return {
    id: `custom-${createSlug(category)}-${createSlug(label)}-${Date.now()}-${randomSuffix}`,
    label,
    category,
    createdAt: new Date().toISOString()
  };
}

export function buildServiceCatalog(customServices: CustomService[]): ServiceCatalogItem[] {
  const base = getSeedServices();
  const merged = [...base];
  const unique = new Set(base.map((service) => serviceKey(service.label, service.category)));

  for (const custom of customServices) {
    const key = serviceKey(custom.label, custom.category);
    if (unique.has(key)) {
      continue;
    }

    unique.add(key);
    merged.push({
      id: custom.id,
      label: custom.label,
      category: custom.category,
      source: "custom"
    });
  }

  return merged;
}

export function searchServices(catalog: ServiceCatalogItem[], query: string, limit = 12): ServiceCatalogItem[] {
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery) {
    return catalog.slice(0, limit);
  }

  // Rank by exact/prefix/contains against service label first, category second.
  const ranked = catalog
    .map((service) => {
      const labelText = normalizeSearchValue(service.label);
      const categoryText = normalizeSearchValue(service.category);
      const combined = `${labelText} ${categoryText}`;

      if (!combined.includes(normalizedQuery)) {
        return null;
      }

      let score = 4;
      if (labelText === normalizedQuery) {
        score = 0;
      } else if (labelText.startsWith(normalizedQuery)) {
        score = 1;
      } else if (labelText.includes(normalizedQuery)) {
        score = 2;
      } else if (categoryText.startsWith(normalizedQuery)) {
        score = 3;
      }

      return {
        service,
        score,
        labelLength: service.label.length,
        customBoost: service.source === "custom" ? -0.2 : 0
      };
    })
    .filter((item): item is { service: ServiceCatalogItem; score: number; labelLength: number; customBoost: number } => Boolean(item))
    .sort((a, b) => {
      const scoreDiff = a.score + a.customBoost - (b.score + b.customBoost);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }

      if (a.labelLength !== b.labelLength) {
        return a.labelLength - b.labelLength;
      }

      return a.service.label.localeCompare(b.service.label, "de");
    })
    .slice(0, Math.max(1, limit));

  return ranked.map((item) => item.service);
}

export function hasServiceLabel(catalog: ServiceCatalogItem[], label: string): boolean {
  const normalized = normalizeSearchValue(label);
  if (!normalized) {
    return false;
  }

  return catalog.some((service) => normalizeSearchValue(service.label) === normalized);
}
