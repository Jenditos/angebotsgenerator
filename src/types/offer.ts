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
};
