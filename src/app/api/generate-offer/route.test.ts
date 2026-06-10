import {
  handleGenerateOfferAuthorizedRequest,
  sanitizeOfferDebugPayload,
} from "./route";

jest.mock("@react-pdf/renderer", () => ({
  renderToBuffer: jest.fn(),
  Document: jest.fn(),
  Font: {
    registerHyphenationCallback: jest.fn(),
  },
  Image: jest.fn(),
  Page: jest.fn(),
  StyleSheet: {
    create: (styles: unknown) => styles,
  },
  Text: jest.fn(),
  View: jest.fn(),
}));

describe("handleGenerateOfferAuthorizedRequest", () => {
  it("removes PII and PDF payload data from debug output", () => {
    expect(
      sanitizeOfferDebugPayload({
        documentNumber: "ANG-2026-001",
        lineItemsCount: 1,
        hasCustomerEmail: true,
        customerName: "Max Mustermann",
        customerAddress: "Musterstrasse 1",
        customerEmail: "max@example.com",
        serviceDescription: "Vertrauliche Leistung",
        lineItems: [{ description: "Vertrauliche Position" }],
        settings: {
          companyName: "Musterbetrieb",
          hasCompanyName: true,
        },
      }),
    ).toEqual({
      documentNumber: "ANG-2026-001",
      lineItemsCount: 1,
      hasCustomerEmail: true,
      settings: {
        hasCompanyName: true,
      },
    });
  });

  it("rejects an invalid customer email before generating an offer", async () => {
    const response = await handleGenerateOfferAuthorizedRequest(
      new Request("https://example.com/api/generate-offer", {
        method: "POST",
        body: JSON.stringify({
          customerType: "person",
          firstName: "Max",
          lastName: "Mustermann",
          street: "Musterstrasse 1",
          postalCode: "12345",
          city: "Musterstadt",
          customerEmail: "ungueltige-email",
          serviceDescription: "Malerarbeiten",
          hours: 1,
          hourlyRate: 50,
          materialCost: 0,
        }),
      }),
      { userId: "user-1" },
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Bitte eine gültige E-Mail-Adresse eingeben.");
  });

  it("rejects oversized free-text input before generating an offer", async () => {
    const response = await handleGenerateOfferAuthorizedRequest(
      new Request("https://example.com/api/generate-offer", {
        method: "POST",
        body: JSON.stringify({
          customerType: "person",
          firstName: "Max",
          lastName: "Mustermann",
          street: "Musterstrasse 1",
          postalCode: "12345",
          city: "Musterstadt",
          customerEmail: "max@example.com",
          serviceDescription: "a".repeat(10_001),
          hours: 1,
          hourlyRate: 50,
          materialCost: 0,
        }),
      }),
      { userId: "user-1" },
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toContain("serviceDescription");
    expect(payload.error).toContain("10.000");
  });
});
