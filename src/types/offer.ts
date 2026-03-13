export type OfferText = {
  subject: string;
  intro: string;
  details: string;
  closing: string;
};

export type PdfTableColumnId =
  | "position"
  | "quantity"
  | "description"
  | "unit"
  | "unitPrice"
  | "totalPrice";

export type PdfTableColumnConfig = {
  id: PdfTableColumnId;
  label: string;
  visible: boolean;
  order: number;
};

export type OfferPdfLineItem = {
  position: number;
  quantity: number;
  group?: string;
  description: string;
  unit: string;
  unitPrice: number;
  totalPrice: number;
};

export type OfferPromptInput = {
  customerName: string;
  customerAddress: string;
  serviceDescription: string;
  hours: number;
  hourlyRate: number;
  materialCost: number;
};

export type ServiceSource = "seed" | "custom";

export type ServiceCategory = {
  id: string;
  label: string;
};

export type ServiceCatalogItem = {
  id: string;
  label: string;
  category: string;
  source: ServiceSource;
};

export type CustomService = {
  id: string;
  label: string;
  category: string;
  createdAt: string;
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
  pdfTableColumns: PdfTableColumnConfig[];
  customServices: CustomService[];
  vatRate: number;
  offerValidityDays: number;
  offerTermsText: string;
};

export type OfferPositionInput = {
  quantity?: number | string;
  group?: string;
  description?: string;
  unit?: string;
  unitPrice?: number | string;
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
  selectedServices?: string[];
  positions?: OfferPositionInput[];
  hours: number | string;
  hourlyRate: number | string;
  materialCost: number | string;
  sendEmail?: boolean;
};
