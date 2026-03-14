export type OfferText = {
  subject: string;
  intro: string;
  details: string;
  closing: string;
};

export type OfferPromptInput = {
  customerName: string;
  customerAddress: string;
  serviceDescription: string;
  hours: number;
  hourlyRate: number;
  materialCost: number;
};

export type CompanySettings = {
  companyName: string;
  ownerName: string;
  companyStreet: string;
  companyPostalCode: string;
  companyCity: string;
  // Legacy field for older stored settings files.
  companyPostalCity?: string;
  companyEmail: string;
  companyPhone: string;
  companyWebsite: string;
  senderCopyEmail: string;
  logoDataUrl: string;
  // Letzte manuell hinterlegte Startnummer, z. B. ANG-2026-991490
  startOfferNumber: string;
  // Vom System zuletzt verwendete Angebotsnummer
  lastOfferNumber: string;
  // Fallback-Zähler falls kein numerischer Suffix erkennbar ist
  offerNumberFallbackCounter: number;
  // Firmenspezifische zusätzliche Leistungsarten
  customServiceTypes: string[];
};

export type GenerateOfferRequest = {
  customerType: "person" | "company";
  salutation?: "herr" | "frau";
  companyName?: string;
  firstName?: string;
  lastName?: string;
  street: string;
  postalCode: string;
  city: string;
  customerEmail: string;
  serviceDescription: string;
  hours: number | string;
  hourlyRate: number | string;
  materialCost: number | string;
  sendEmail?: boolean;
  offerNumber?: string;
};

export type OfferSettings = Pick<CompanySettings, "startOfferNumber" | "lastOfferNumber" | "offerNumberFallbackCounter" | "customServiceTypes">;
