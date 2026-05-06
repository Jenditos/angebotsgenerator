export type OfferText = {
  subject: string;
  intro: string;
  details: string;
  closing: string;
};

export type DocumentType = "offer" | "invoice";
export type DocumentTaxTreatment = "standard" | "reverse_charge" | "vat_exempt";

export const DOCUMENT_PROCESSING_STATUS_VALUES = [
  "offer_created",
  "pdf_ready",
  "email_prepared",
  "email_sent",
  "email_failed",
  "failed",
] as const;

export type DocumentProcessingStatus =
  (typeof DOCUMENT_PROCESSING_STATUS_VALUES)[number];

export type StoredPdfReference = {
  storageProvider?: "local" | "supabase";
  bucket?: string;
  storageKey: string;
  filename: string;
  contentType: "application/pdf";
  byteLength: number;
  createdAt: string;
  updatedAt?: string;
};

export type StoredEmailStatus = "prepared" | "sent" | "failed";

export type StoredEmailProvider = "google" | "microsoft" | "resend";

export type StoredEmailReference = {
  status: StoredEmailStatus;
  provider?: StoredEmailProvider;
  idempotencyKey?: string;
  draftId?: string;
  composeUrl?: string;
  preparedAt?: string;
  sentAt?: string;
  failedAt?: string;
  updatedAt: string;
};

export const DOCUMENT_PAYMENT_STATUS_VALUES = [
  "unpaid",
  "pending",
  "paid",
  "failed",
  "refunded",
] as const;

export type DocumentPaymentStatus =
  (typeof DOCUMENT_PAYMENT_STATUS_VALUES)[number];

export type StoredPaymentReference = {
  status: DocumentPaymentStatus;
  provider?: string;
  reference?: string;
  paidAt?: string;
  updatedAt: string;
};

export type DocumentTaxInfo = {
  treatment: DocumentTaxTreatment;
  noticeText?: string;
};

export const PROJECT_STATUS_VALUES = [
  "new",
  "site_visit_planned",
  "offer_sent",
  "order_confirmed",
  "in_progress",
  "completed",
  "paid",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUS_VALUES)[number];

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

export type IbanVerificationStatus = "not_checked" | "valid";

export type AdditionalBankAccount = {
  id: string;
  label: string;
  iban: string;
  bic: string;
  bankName: string;
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
  companyIban: string;
  companyBic: string;
  companyBankName: string;
  ibanVerificationStatus: IbanVerificationStatus;
  additionalBankAccounts: AdditionalBankAccount[];
  defaultBankAccountId: string;
  taxNumber: string;
  vatId: string;
  companyCountry: string;
  euVatNoticeText: string;
  includeCustomerVatId: boolean;
  senderCopyEmail: string;
  logoDataUrl: string;
  pdfTableColumns: PdfTableColumnConfig[];
  customServices: CustomService[];
  vatRate: number;
  offerValidityDays: number;
  invoicePaymentDueDays: number;
  offerTermsText: string;
  lastOfferNumber: string;
  lastInvoiceNumber: string;
  customServiceTypes: string[];
};

export type OfferPositionInput = {
  quantity?: number | string;
  group?: string;
  description?: string;
  unit?: string;
  unitPrice?: number | string;
};

export type CustomerDraftSubitem = {
  description: string;
  quantity: string;
  unit: string;
  price: string;
};

export type CustomerDraftGroup = {
  label: string;
  subitems: CustomerDraftSubitem[];
};

export type CustomerDraftState = {
  serviceDescription: string;
  hours: string;
  hourlyRate: string;
  materialCost: string;
  invoiceDate: string;
  serviceDate: string;
  paymentDueDays: string;
  positions: CustomerDraftGroup[];
  documentTax?: DocumentTaxInfo | null;
};

export type GenerateOfferRequest = {
  idempotencyKey?: string;
  documentType?: DocumentType;
  documentTax?: DocumentTaxInfo | null;
  customerNumber?: string;
  projectNumber?: string;
  projectName?: string;
  projectAddress?: string;
  projectStatus?: ProjectStatus;
  projectNote?: string;
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
  selectedServiceEntries?: Array<{
    label?: string;
    subitems?: Array<{
      description?: string;
      quantity?: string;
      unit?: string;
      price?: string;
    }>;
  }>;
  positions?: OfferPositionInput[];
  hours: number | string;
  hourlyRate: number | string;
  materialCost: number | string;
  invoiceDate?: string;
  serviceDate?: string;
  paymentDueDays?: number | string;
  settings?: Partial<CompanySettings>;
  sendEmail?: boolean;
};

export type StoredCustomerRecord = {
  customerNumber: string;
  customerType: "person" | "company";
  companyName: string;
  salutation: "herr" | "frau";
  firstName: string;
  lastName: string;
  street: string;
  postalCode: string;
  city: string;
  customerEmail: string;
  customerName: string;
  customerAddress: string;
  draftState?: CustomerDraftState;
  createdAt: string;
  updatedAt: string;
};

export type StoredProjectRecord = {
  projectNumber: string;
  customerNumber?: string;
  customerType: "person" | "company";
  companyName: string;
  salutation: "herr" | "frau";
  firstName: string;
  lastName: string;
  street: string;
  postalCode: string;
  city: string;
  customerName: string;
  customerAddress: string;
  customerEmail: string;
  projectName: string;
  projectAddress: string;
  status: ProjectStatus;
  note: string;
  draftState?: CustomerDraftState;
  createdAt: string;
  updatedAt: string;
};

export type StoredOfferRecord = {
  documentType?: DocumentType;
  offerNumber: string;
  idempotencyKey?: string;
  status?: DocumentProcessingStatus;
  pdf?: StoredPdfReference;
  email?: StoredEmailReference;
  payment?: StoredPaymentReference;
  customerNumber?: string;
  projectNumber?: string;
  projectName?: string;
  projectAddress?: string;
  createdAt: string;
  created_at: string;
  updatedAt?: string;
  customerName: string;
  customerAddress: string;
  customerEmail: string;
  serviceDescription: string;
  lineItems: OfferPdfLineItem[];
  documentTax?: DocumentTaxInfo | null;
  offer: OfferText;
};
