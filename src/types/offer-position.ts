export type OfferUnit = "Std." | "m²" | "Stk." | "lfm" | "Pauschal";

export type OfferPosition = {
  id: string;
  serviceType: string;
  description: string;
  quantity: number;
  unit: OfferUnit;
  unitPrice: number;
  totalPrice: number;
};

export type OfferTotals = {
  netTotal: number;
  vatAmount: number;
  grossTotal: number;
};

export type OfferPositionsChangePayload = {
  positions: OfferPosition[];
  totals: OfferTotals;
};

export type ServiceTypeCategory = {
  label: string;
  options: string[];
};

// Standardkatalog für Bau/Handwerk. Firmeneigene Leistungsarten werden zusätzlich gemerged.
export const DEFAULT_SERVICE_TYPE_CATEGORIES: ServiceTypeCategory[] = [
  {
    label: "Allgemein",
    options: ["Angebot", "Baustelleneinrichtung", "An- und Abfahrt", "Entsorgung", "Reinigung"]
  },
  {
    label: "Neubau/Rohbau",
    options: [
      "Erdarbeiten",
      "Fundamentarbeiten",
      "Mauerarbeiten",
      "Betonarbeiten",
      "Bewehrung",
      "Schalungsarbeiten",
      "Abdichtungsarbeiten",
      "Kellerbau",
      "Stahlbau",
      "Zimmererarbeiten",
      "Gerüstarbeiten"
    ]
  },
  {
    label: "Dach/Fassade",
    options: [
      "Dachdeckungsarbeiten",
      "Dachabdichtungsarbeiten",
      "Dachdämmung",
      "Spengler-/Klempnerarbeiten",
      "Fassadendämmung",
      "Putz- und Stuckarbeiten",
      "WDVS",
      "vorgehängte hinterlüftete Fassade",
      "Fassadenanstrich"
    ]
  },
  {
    label: "Innenausbau",
    options: [
      "Trockenbauarbeiten",
      "Innenputz",
      "Estricharbeiten",
      "Fliesen- und Plattenarbeiten",
      "Bodenbelagsarbeiten (Parkett, Laminat, Vinyl, Teppich)",
      "Maler- und Lackierarbeiten",
      "Tapezierarbeiten",
      "Innentüren/Fenster einbauen"
    ]
  },
  {
    label: "Haustechnik",
    options: [
      "Elektroinstallation (Stark- und Schwachstrom)",
      "Beleuchtung",
      "Netzwerk-/Datenverkabelung",
      "Blitzschutz",
      "Sanitärinstallation (Wasser/Abwasser)",
      "Heizungsinstallation",
      "Lüftungsanlage",
      "Wärmepumpe",
      "Fußbodenheizung"
    ]
  },
  {
    label: "Außenanlagen/Tiefbau",
    options: [
      "Entwässerungsarbeiten",
      "Dränarbeiten",
      "Pflasterarbeiten",
      "Natursteinarbeiten",
      "Zaunbau",
      "Carport/Garage",
      "Garten- und Landschaftsbau",
      "Erdmodellierung",
      "Begrünung/Bepflanzung"
    ]
  },
  {
    label: "Renovierung/Sanierung",
    options: [
      "Renovierung",
      "Sanierung",
      "Modernisierung",
      "Teilsanierung",
      "Altbausanierung",
      "Badsanierung",
      "Fassadensanierung",
      "Betonsanierung",
      "Schimmelsanierung",
      "energetische Sanierung",
      "Dachsanierung",
      "Fenstertausch"
    ]
  },
  {
    label: "Instandhaltung/Wartung",
    options: [
      "Wartung",
      "Inspektion",
      "Instandsetzung",
      "Reparatur",
      "Dichtheitsprüfung",
      "Anlagenprüfung",
      "regelmäßige Wartungsverträge"
    ]
  },
  {
    label: "Spezialleistungen",
    options: [
      "Photovoltaik-Anlage",
      "Solarthermie",
      "Smart-Home-Installation",
      "Brandschutzmaßnahmen",
      "Barrierefreier Umbau",
      "Abdichtung von Balkonen/Terrassen"
    ]
  }
];

export const DEFAULT_SERVICE_TYPES: string[] = DEFAULT_SERVICE_TYPE_CATEGORIES.flatMap((category) => category.options);
