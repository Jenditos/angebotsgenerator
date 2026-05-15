export type HandwerkTradeSection = "A" | "B1" | "B2";

export type HandwerkTrade = {
  id: string;
  name: string;
  section: HandwerkTradeSection;
  sectionLabel: string;
  officialIndex: number;
  searchText: string;
};

export type HandwerkTradeGroup = {
  section: HandwerkTradeSection;
  label: string;
  description: string;
  trades: HandwerkTrade[];
};

export type TradePlaceholders = {
  serviceSearch: string;
  serviceDescription: string;
  positionDescription: string;
};

type TradeGroupSeed = {
  section: HandwerkTradeSection;
  label: string;
  description: string;
  trades: string[];
};

type TradeServicePreset = {
  match: string[];
  services: string[];
  placeholders: TradePlaceholders;
  aiHint: string;
};

const SECTION_LABELS: Record<HandwerkTradeSection, string> = {
  A: "Anlage A - zulassungspflichtige Handwerke",
  B1: "Anlage B1 - zulassungsfreie Handwerke",
  B2: "Anlage B2 - handwerksähnliche Gewerbe",
};

const HANDWERK_TRADE_GROUP_SEEDS: TradeGroupSeed[] = [
  {
    section: "A",
    label: SECTION_LABELS.A,
    description: "53 aktuell zulassungspflichtige Handwerke nach HwO Anlage A.",
    trades: [
      "Maurer und Betonbauer",
      "Ofen- und Luftheizungsbauer",
      "Zimmerer",
      "Dachdecker",
      "Straßenbauer",
      "Wärme-, Kälte- und Schallschutzisolierer",
      "Brunnenbauer",
      "Steinmetzen und Steinbildhauer",
      "Stuckateure",
      "Maler und Lackierer",
      "Gerüstbauer",
      "Schornsteinfeger",
      "Metallbauer",
      "Chirurgiemechaniker",
      "Karosserie- und Fahrzeugbauer",
      "Feinwerkmechaniker",
      "Zweiradmechaniker",
      "Kälteanlagenbauer",
      "Informationstechniker",
      "Kraftfahrzeugtechniker",
      "Land- und Baumaschinenmechatroniker",
      "Büchsenmacher",
      "Klempner",
      "Installateur und Heizungsbauer",
      "Elektrotechniker",
      "Elektromaschinenbauer",
      "Tischler",
      "Boots- und Schiffbauer",
      "Seiler",
      "Bäcker",
      "Konditor",
      "Fleischer",
      "Augenoptiker",
      "Hörakustiker",
      "Orthopädietechniker",
      "Orthopädieschuhmacher",
      "Zahntechniker",
      "Friseure",
      "Glaser",
      "Glasbläser und Glasapparatebauer",
      "Mechaniker für Reifen- und Vulkanisationstechnik",
      "Fliesen-, Platten- und Mosaikleger",
      "Werkstein- und Terrazzohersteller",
      "Estrichleger",
      "Behälter und Apparatebauer",
      "Parkettleger",
      "Rollladen- und Sonnenschutztechniker",
      "Drechsler (Elfenbeinschnitzer) und Holzspielzeugmacher",
      "Böttcher",
      "Glasveredler",
      "Schilder- und Lichtreklamehersteller",
      "Raumausstatter",
      "Orgel- und Harmoniumbauer",
    ],
  },
  {
    section: "B1",
    label: SECTION_LABELS.B1,
    description: "41 aktuell aktive zulassungsfreie Handwerke nach HwO Anlage B1.",
    trades: [
      "Uhrmacher",
      "Graveure",
      "Metallbildner",
      "Galvaniseure",
      "Metall- und Glockengießer",
      "Präzisionswerkzeugmechaniker",
      "Gold- und Silberschmiede",
      "Modellbauer",
      "Holzbildhauer",
      "Korb- und Flechtwerkgestalter",
      "Maßschneider",
      "Textilgestalter (Sticker, Weber, Klöppler, Posamentierer, Stricker)",
      "Modisten",
      "Segelmacher",
      "Kürschner",
      "Schuhmacher",
      "Sattler und Feintäschner",
      "Müller",
      "Brauer und Mälzer",
      "Weinküfer",
      "Textilreiniger",
      "Wachszieher",
      "Gebäudereiniger",
      "Feinoptiker",
      "Glas- und Porzellanmaler",
      "Edelsteinschleifer und -graveure",
      "Fotografen",
      "Buchbinder",
      "Print- und Medientechnologen (Drucker, Siebdrucker, Flexografen)",
      "Keramiker",
      "Klavier- und Cembalobauer",
      "Handzuginstrumentenmacher",
      "Geigenbauer",
      "Bogenmacher",
      "Metallblasinstrumentenmacher",
      "Holzblasinstrumentenmacher",
      "Zupfinstrumentenmacher",
      "Vergolder",
      "Holz- und Bautenschützer (Mauerschutz und Holzimprägnierung in Gebäuden)",
      "Bestatter",
      "Kosmetiker",
    ],
  },
  {
    section: "B2",
    label: SECTION_LABELS.B2,
    description: "51 aktuell aktive handwerksähnliche Gewerbe nach HwO Anlage B2.",
    trades: [
      "Eisenflechter",
      "Bautentrocknungsgewerbe",
      "Bodenleger",
      "Asphaltierer (ohne Straßenbau)",
      "Fuger (im Hochbau)",
      "Rammgewerbe (Einrammen von Pfählen im Wasserbau)",
      "Betonbohrer und -schneider",
      "Theater- und Ausstattungsmaler",
      "Herstellung von Drahtgestellen für Dekorationszwecke in Sonderanfertigung",
      "Metallschleifer und Metallpolierer",
      "Metallsägen-Schärfer",
      "Tankschutzbetriebe (Korrosionsschutz von Öltanks für Feuerungsanlagen ohne chemische Verfahren)",
      "Fahrzeugverwerter",
      "Rohr- und Kanalreiniger",
      "Kabelverleger im Hochbau (ohne Anschlussarbeiten)",
      "Holzschuhmacher",
      "Holzblockmacher",
      "Daubenhauer",
      "Holz-Leitermacher (Sonderanfertigung)",
      "Muldenhauer",
      "Holzreifenmacher",
      "Holzschindelmacher",
      "Einbau von genormten Baufertigteilen (z. B. Fenster, Türen, Zargen, Regale)",
      "Bürsten- und Pinselmacher",
      "Bügelanstalten für Herren-Oberbekleidung",
      "Dekorationsnäher (ohne Schaufensterdekoration)",
      "Fleckteppichhersteller",
      "Theaterkostümnäher",
      "Plisseebrenner",
      "Stoffmaler",
      "Textil-Handdrucker",
      "Kunststopfer",
      "Änderungsschneider (ehemals Flickschneider)",
      "Handschuhmacher",
      "Ausführung einfacher Schuhreparaturen",
      "Gerber",
      "Innerei-Fleischer (Kuttler)",
      "Speiseeishersteller (mit Vertrieb von Speiseeis mit üblichem Zubehör)",
      "Fleischzerleger, Ausbeiner",
      "Appreteure, Dekateure",
      "Schnellreiniger",
      "Teppichreiniger",
      "Getränkeleitungsreiniger",
      "Maskenbildner",
      "Lampenschirmhersteller (Sonderanfertigung)",
      "Klavierstimmer",
      "Theaterplastiker",
      "Requisiteure",
      "Schirmmacher",
      "Steindrucker",
      "Schlagzeugmacher",
    ],
  },
];

const LEGACY_TRADE_ALIASES: Record<string, string> = {
  "maler ausbau": "Maler und Lackierer",
  "maler und ausbau": "Maler und Lackierer",
  shk: "Installateur und Heizungsbauer",
  elektro: "Elektrotechniker",
  tischler: "Tischler",
  trockenbau: "Stuckateure",
  boden: "Bodenleger",
  bodenleger: "Bodenleger",
};

const DEFAULT_PLACEHOLDERS: TradePlaceholders = {
  serviceSearch: "z. B. Aufmaß, Montage, Wartung oder Material",
  serviceDescription:
    "z. B. Ausführung der besprochenen Arbeiten inkl. Material, Nebenleistungen und Baustelleneinrichtung",
  positionDescription: "z. B. Aufmaß, Arbeitsleistung, Material oder Montage",
};

const TRADE_SERVICE_PRESETS: TradeServicePreset[] = [
  {
    match: ["Maler und Lackierer", "Theater- und Ausstattungsmaler"],
    services: [
      "Untergrund vorbereiten",
      "Spachtelarbeiten",
      "Innenanstrich",
      "Fassadenanstrich",
      "Tapezierarbeiten",
      "Lackierarbeiten",
      "Schutzabdeckung und Abklebearbeiten",
      "Schimmelsanierung",
    ],
    placeholders: {
      serviceSearch: "z. B. Innenanstrich, Spachteln, Tapezieren oder Fassade",
      serviceDescription:
        "z. B. Wände und Decken spachteln, schleifen und zweimal deckend streichen",
      positionDescription: "z. B. Q3-Spachtelung, Dispersionsanstrich oder Abklebearbeiten",
    },
    aiHint:
      "Achte auf Untergrundvorbereitung, Beschichtungsaufbau, Qualitätsstufen, Flächenangaben und Schutzarbeiten.",
  },
  {
    match: ["Installateur und Heizungsbauer", "Ofen- und Luftheizungsbauer"],
    services: [
      "Sanitärinstallation",
      "Heizungsinstallation",
      "Badsanierung",
      "Rohrleitungen verlegen",
      "Armaturen montieren",
      "Wartung Heizungsanlage",
      "Demontage Altanlage",
      "Inbetriebnahme und Funktionsprüfung",
    ],
    placeholders: {
      serviceSearch: "z. B. Sanitärinstallation, Heizkörper, Rohrleitungen oder Wartung",
      serviceDescription:
        "z. B. Austausch der Sanitärobjekte inkl. Rohranschluss, Dichtheitsprüfung und Inbetriebnahme",
      positionDescription: "z. B. Rohrleitung verlegen, Waschtisch montieren oder Heizkörper tauschen",
    },
    aiHint:
      "Berücksichtige Demontage, Leitungsführung, Armaturen, Dichtheitsprüfung, Inbetriebnahme und technische Nebenleistungen.",
  },
  {
    match: ["Elektrotechniker", "Informationstechniker", "Elektromaschinenbauer", "Kabelverleger im Hochbau"],
    services: [
      "Elektroinstallation",
      "Zuleitung verlegen",
      "Schalter und Steckdosen montieren",
      "Unterverteilung anschließen",
      "Beleuchtung installieren",
      "Netzwerkverkabelung",
      "Messung und Prüfprotokoll",
      "Fehlersuche",
    ],
    placeholders: {
      serviceSearch: "z. B. Elektroinstallation, Beleuchtung, Unterverteilung oder Netzwerk",
      serviceDescription:
        "z. B. Installation neuer Steckdosen und Leuchten inkl. Leitungsführung und Prüfprotokoll",
      positionDescription: "z. B. NYM-Leitung verlegen, Steckdose montieren oder Messprotokoll",
    },
    aiHint:
      "Nutze elektrotechnische Begriffe, Prüfungen, Leitungswege, Absicherung und Dokumentation, ohne Sicherheitsversprechen zu überziehen.",
  },
  {
    match: ["Tischler", "Einbau von genormten Baufertigteilen", "Modellbauer"],
    services: [
      "Aufmaß und Planung",
      "Möbelbau",
      "Türmontage",
      "Fenstermontage",
      "Einbauschrank fertigen",
      "Beschläge montieren",
      "Oberflächenbehandlung",
      "Reparatur Holzbauteile",
    ],
    placeholders: {
      serviceSearch: "z. B. Aufmaß, Türmontage, Einbauschrank oder Beschläge",
      serviceDescription:
        "z. B. Fertigung und Montage eines Einbauschranks inkl. Aufmaß, Beschlägen und Oberfläche",
      positionDescription: "z. B. Korpus fertigen, Türblatt montieren oder Beschläge einstellen",
    },
    aiHint:
      "Berücksichtige Aufmaß, Fertigung, Material, Beschläge, Montage, Oberfläche und Passarbeiten vor Ort.",
  },
  {
    match: ["Dachdecker", "Zimmerer", "Klempner"],
    services: [
      "Dachflächen vorbereiten",
      "Dacheindeckung",
      "Dachabdichtung",
      "Dachrinne montieren",
      "Holzkonstruktion",
      "Wärmedämmung",
      "Anschlussdetails",
      "Reparatur Dachschaden",
    ],
    placeholders: {
      serviceSearch: "z. B. Dacheindeckung, Abdichtung, Rinne oder Dämmung",
      serviceDescription:
        "z. B. Dachfläche neu eindecken inkl. Unterspannbahn, Lattung und Anschlussarbeiten",
      positionDescription: "z. B. Lattung montieren, Dachrinne setzen oder Anschlussblech herstellen",
    },
    aiHint:
      "Achte auf Dachaufbau, Abdichtung, Anschlüsse, Entwässerung, Gerüst-/Sicherungsanteile und witterungsfeste Ausführung.",
  },
  {
    match: ["Fliesen-, Platten- und Mosaikleger", "Werkstein- und Terrazzohersteller", "Estrichleger"],
    services: [
      "Untergrund prüfen und vorbereiten",
      "Abdichtung herstellen",
      "Fliesen verlegen",
      "Sockelarbeiten",
      "Fugenarbeiten",
      "Silikonfugen",
      "Estricharbeiten",
      "Naturstein- und Terrazzoarbeiten",
    ],
    placeholders: {
      serviceSearch: "z. B. Fliesen verlegen, Abdichtung, Fugen oder Estrich",
      serviceDescription:
        "z. B. Verlegung von 60x60 Feinsteinzeugfliesen inkl. Abdichtung, Fugen und Silikon",
      positionDescription: "z. B. Verbundabdichtung, Feinsteinzeug verlegen oder Silikonfuge",
    },
    aiHint:
      "Nutze Angaben zu Untergrund, Abdichtung, Format, Verlegemuster, Fugen, Sockeln und Bewegungsfugen.",
  },
  {
    match: ["Bodenleger", "Parkettleger", "Raumausstatter"],
    services: [
      "Untergrund vorbereiten",
      "Ausgleichsmasse aufbringen",
      "Parkett verlegen",
      "Vinylboden verlegen",
      "Teppichboden verlegen",
      "Sockelleisten montieren",
      "Schleifen und Versiegeln",
      "Altbelag entfernen",
    ],
    placeholders: {
      serviceSearch: "z. B. Vinylboden, Parkett, Ausgleichsmasse oder Sockelleisten",
      serviceDescription:
        "z. B. Altbelag entfernen, Untergrund ausgleichen und Vinylboden inkl. Sockelleisten verlegen",
      positionDescription: "z. B. Altbelag entfernen, Klickvinyl verlegen oder Sockelleiste montieren",
    },
    aiHint:
      "Berücksichtige Untergrundprüfung, Restfeuchte, Ausgleich, Belagstyp, Sockelleisten und Übergangsprofile.",
  },
  {
    match: ["Stuckateure", "Wärme-, Kälte- und Schallschutzisolierer"],
    services: [
      "Trockenbauarbeiten",
      "Innenputz",
      "Außenputz",
      "Wärmedämmverbundsystem",
      "Spachtelarbeiten",
      "Decken abhängen",
      "Trennwand stellen",
      "Schallschutzmaßnahmen",
    ],
    placeholders: {
      serviceSearch: "z. B. Trockenbau, Innenputz, WDVS oder Schallschutz",
      serviceDescription:
        "z. B. Trockenbauwand stellen, beplanken, verspachteln und malerfertig vorbereiten",
      positionDescription: "z. B. CW/UW-Profile stellen, Gipskarton beplanken oder Q2-Spachtelung",
    },
    aiHint:
      "Achte auf Schichtenaufbau, Plattenlage, Putzsystem, Dämmung, Oberflächenqualität und Brandschutz-/Schallschutzangaben.",
  },
  {
    match: ["Maurer und Betonbauer", "Straßenbauer", "Asphaltierer", "Betonbohrer und -schneider", "Eisenflechter"],
    services: [
      "Baustelleneinrichtung",
      "Abbrucharbeiten",
      "Mauerarbeiten",
      "Betonarbeiten",
      "Schalungsarbeiten",
      "Bewehrung einbauen",
      "Fundament herstellen",
      "Pflaster- und Asphaltarbeiten",
    ],
    placeholders: {
      serviceSearch: "z. B. Mauerwerk, Beton, Fundament, Bewehrung oder Pflaster",
      serviceDescription:
        "z. B. Herstellung eines Streifenfundaments inkl. Aushub, Schalung, Bewehrung und Betonage",
      positionDescription: "z. B. Schalung herstellen, Beton liefern/einbauen oder Pflasterfläche herstellen",
    },
    aiHint:
      "Nutze Mengen, Beton-/Steinqualitäten, Bewehrung, Schalung, Erdarbeiten, Verdichtung und Baustelleneinrichtung.",
  },
  {
    match: ["Metallbauer", "Feinwerkmechaniker", "Behälter und Apparatebauer", "Metallbildner"],
    services: [
      "Aufmaß und Werkplanung",
      "Stahlkonstruktion fertigen",
      "Geländer montieren",
      "Schweißarbeiten",
      "Korrosionsschutz",
      "Blechbearbeitung",
      "Montage vor Ort",
      "Reparatur Metallbauteile",
    ],
    placeholders: {
      serviceSearch: "z. B. Geländer, Schweißarbeiten, Stahlbau oder Korrosionsschutz",
      serviceDescription:
        "z. B. Fertigung und Montage eines Stahlgeländers inkl. Aufmaß, Korrosionsschutz und Befestigung",
      positionDescription: "z. B. Geländer fertigen, Schweißnaht ausführen oder Korrosionsschutz",
    },
    aiHint:
      "Achte auf Material, Oberflächen, Verbindungstechnik, Montagepunkte, Korrosionsschutz und technische Maße.",
  },
  {
    match: ["Gebäudereiniger", "Glasreiniger", "Schnellreiniger", "Teppichreiniger", "Getränkeleitungsreiniger"],
    services: [
      "Grundreinigung",
      "Unterhaltsreinigung",
      "Glasreinigung",
      "Bauendreinigung",
      "Teppichreinigung",
      "Fassadenreinigung",
      "Desinfektionsreinigung",
      "Sonderreinigung",
    ],
    placeholders: {
      serviceSearch: "z. B. Grundreinigung, Glasreinigung, Bauendreinigung oder Teppich",
      serviceDescription:
        "z. B. Bauendreinigung der Gewerbefläche inkl. Fenster, Böden und Sanitärbereiche",
      positionDescription: "z. B. Glasfläche reinigen, Boden grundreinigen oder Sanitärbereich reinigen",
    },
    aiHint:
      "Nutze Reinigungsart, Fläche, Turnus, Verschmutzungsgrad, Reinigungsmittel und Objektbereiche.",
  },
  {
    match: ["Friseure", "Kosmetiker", "Maskenbildner"],
    services: [
      "Beratung",
      "Waschen, Schneiden und Styling",
      "Färbung",
      "Pflegebehandlung",
      "Kosmetikbehandlung",
      "Make-up",
      "Material und Produkte",
      "Terminpauschale",
    ],
    placeholders: {
      serviceSearch: "z. B. Beratung, Schnitt, Farbe, Pflege oder Behandlung",
      serviceDescription:
        "z. B. Beratung, Schnitt und Styling inkl. Pflegebehandlung und eingesetzter Produkte",
      positionDescription: "z. B. Haarschnitt, Farbservice, Pflegebehandlung oder Make-up",
    },
    aiHint:
      "Formuliere kundenfreundlich, mit klaren Behandlungs- oder Servicepaketen und Material-/Produktanteilen.",
  },
  {
    match: ["Fotografen"],
    services: [
      "Vorgespräch und Konzept",
      "Fotoshooting",
      "Bildauswahl",
      "Bildbearbeitung",
      "Nutzungsrechte",
      "Anfahrt",
      "Online-Galerie",
      "Druckdatenbereitstellung",
    ],
    placeholders: {
      serviceSearch: "z. B. Fotoshooting, Bildbearbeitung, Nutzungsrechte oder Galerie",
      serviceDescription:
        "z. B. Business-Shooting inkl. Vorgespräch, Aufnahmezeit, Bildauswahl und Retusche",
      positionDescription: "z. B. Shooting-Stunde, Retusche pro Bild oder Nutzungsrechte",
    },
    aiHint:
      "Achte auf Shootingdauer, Bildanzahl, Retusche, Nutzungsrechte, Lieferformat und Termin-/Anfahrtsanteile.",
  },
  {
    match: ["Bäcker", "Konditor", "Fleischer", "Speiseeishersteller", "Brauer und Mälzer"],
    services: [
      "Beratung und Planung",
      "Herstellung nach Auftrag",
      "Material und Zutaten",
      "Dekoration",
      "Lieferung",
      "Aufbau vor Ort",
      "Verpackung",
      "Sonderanfertigung",
    ],
    placeholders: {
      serviceSearch: "z. B. Sonderanfertigung, Lieferung, Dekoration oder Verpackung",
      serviceDescription:
        "z. B. Herstellung und Lieferung der bestellten Waren inkl. Zutaten, Verpackung und Aufbau",
      positionDescription: "z. B. Torte herstellen, Lieferung, Dekoration oder Verpackung",
    },
    aiHint:
      "Berücksichtige Stückzahlen, Gewicht, Zutaten, Liefertermin, Verpackung, Kühlung und individuelle Ausführung.",
  },
];

function createSlug(value: string): string {
  const normalized = value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "gewerk";
}

export function normalizeTradeSearchValue(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function createTrade(name: string, section: HandwerkTradeSection, index: number): HandwerkTrade {
  const sectionLabel = SECTION_LABELS[section];

  return {
    id: `${section.toLowerCase()}-${index}-${createSlug(name)}`,
    name,
    section,
    sectionLabel,
    officialIndex: index,
    searchText: normalizeTradeSearchValue(`${name} ${section} ${sectionLabel}`),
  };
}

export const HANDWERK_TRADE_GROUPS: HandwerkTradeGroup[] =
  HANDWERK_TRADE_GROUP_SEEDS.map((group) => ({
    ...group,
    trades: group.trades.map((name, index) =>
      createTrade(name, group.section, index + 1),
    ),
  }));

export const HANDWERK_TRADES: HandwerkTrade[] = HANDWERK_TRADE_GROUPS.flatMap(
  (group) => group.trades,
);

export const HANDWERK_TRADE_NAMES = HANDWERK_TRADES.map((trade) => trade.name);
export const HANDWERK_TRADE_TOTAL_COUNT = HANDWERK_TRADES.length;

const TRADE_LOOKUP = new Map(
  HANDWERK_TRADES.map((trade) => [normalizeTradeSearchValue(trade.name), trade]),
);

function findPreset(tradeName: string): TradeServicePreset | null {
  const normalizedTradeName = normalizeTradeSearchValue(tradeName);

  return (
    TRADE_SERVICE_PRESETS.find((preset) =>
      preset.match.some((matcher) =>
        normalizedTradeName.includes(normalizeTradeSearchValue(matcher)),
      ),
    ) ?? null
  );
}

export function resolveOfficialTradeName(value: string): string | null {
  const normalized = normalizeTradeSearchValue(value);
  if (!normalized) {
    return null;
  }

  const alias = LEGACY_TRADE_ALIASES[normalized];
  if (alias) {
    return alias;
  }

  const trade = TRADE_LOOKUP.get(normalized);
  return trade?.name ?? null;
}

export function getHandwerkTradeByName(value: string | null | undefined): HandwerkTrade | null {
  if (!value) {
    return null;
  }

  const officialName = resolveOfficialTradeName(value);
  if (!officialName) {
    return null;
  }

  return TRADE_LOOKUP.get(normalizeTradeSearchValue(officialName)) ?? null;
}

export function sanitizeHandwerkTradeSelections(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const selected = new Set<string>();
  for (const item of value) {
    const tradeName = resolveOfficialTradeName(String(item).trim());
    if (tradeName) {
      selected.add(tradeName);
    }
  }

  return HANDWERK_TRADE_NAMES.filter((tradeName) => selected.has(tradeName));
}

export function sortHandwerkTradeNames(value: string[]): string[] {
  const selected = new Set(sanitizeHandwerkTradeSelections(value));
  return HANDWERK_TRADE_NAMES.filter((tradeName) => selected.has(tradeName));
}

export function getTradePlaceholders(tradeName: string | null | undefined): TradePlaceholders {
  if (!tradeName) {
    return DEFAULT_PLACEHOLDERS;
  }

  return findPreset(tradeName)?.placeholders ?? {
    serviceSearch: `z. B. ${tradeName}: Beratung, Ausführung, Material oder Wartung`,
    serviceDescription: `z. B. ${tradeName}-Arbeiten nach Besichtigung inkl. Material, Ausführung und Nebenleistungen`,
    positionDescription: `z. B. ${tradeName}: Arbeitsleistung, Material oder Montage`,
  };
}

export function getTradeServiceLabels(tradeName: string | null | undefined): string[] {
  const resolvedTrade = getHandwerkTradeByName(tradeName);
  if (!resolvedTrade) {
    return [
      "Aufmaß und Beratung",
      "Baustelleneinrichtung",
      "Arbeitsleistung",
      "Material und Zubehör",
      "Montage / Ausführung",
      "Reparatur / Wartung",
    ];
  }

  const preset = findPreset(resolvedTrade.name);
  if (preset) {
    return preset.services;
  }

  return [
    `${resolvedTrade.name}: Beratung und Aufmaß`,
    `${resolvedTrade.name}: Arbeitsleistung`,
    `${resolvedTrade.name}: Material und Zubehör`,
    `${resolvedTrade.name}: Montage / Ausführung`,
    `${resolvedTrade.name}: Reparatur / Wartung`,
    `${resolvedTrade.name}: Dokumentation`,
  ];
}

export function getTradeAiContext(tradeName: string | null | undefined): string {
  const resolvedTrade = getHandwerkTradeByName(tradeName);
  if (!resolvedTrade) {
    return "";
  }

  const preset = findPreset(resolvedTrade.name);
  const serviceLabels = getTradeServiceLabels(resolvedTrade.name);
  const hint = preset?.aiHint
    ? ` ${preset.aiHint}`
    : " Verwende fachlich passende, aber für Kunden verständliche Positionsbezeichnungen.";

  return [
    `Ausgewähltes Gewerk: ${resolvedTrade.name} (${resolvedTrade.sectionLabel}).`,
    `Typische Leistungspositionen: ${serviceLabels.join(", ")}.`,
    hint.trim(),
  ].join(" ");
}
