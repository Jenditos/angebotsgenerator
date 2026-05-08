import { parseAppointmentInput } from "./appointment-parser";
import {
  StoredCustomerRecord,
  StoredProjectRecord,
} from "@/types/offer";

const NOW = new Date(2026, 4, 8, 10, 0, 0);

function customer(
  customerNumber: string,
  customerName: string,
): StoredCustomerRecord {
  return {
    userId: "user-1",
    customerNumber,
    customerType: "company",
    companyName: customerName,
    salutation: "herr",
    firstName: "",
    lastName: customerName.split(" ").at(-1) ?? customerName,
    street: "Musterweg 1",
    postalCode: "50667",
    city: "Köln",
    customerEmail: "kunde@example.com",
    customerName,
    customerAddress: `${customerName}, Musterweg 1, 50667 Köln`,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
}

function project(
  projectNumber: string,
  projectName: string,
  customerRecord: StoredCustomerRecord,
): StoredProjectRecord {
  return {
    userId: "user-1",
    projectNumber,
    customerNumber: customerRecord.customerNumber,
    customerType: customerRecord.customerType,
    companyName: customerRecord.companyName,
    salutation: customerRecord.salutation,
    firstName: customerRecord.firstName,
    lastName: customerRecord.lastName,
    street: customerRecord.street,
    postalCode: customerRecord.postalCode,
    city: customerRecord.city,
    customerName: customerRecord.customerName,
    customerAddress: customerRecord.customerAddress,
    customerEmail: customerRecord.customerEmail,
    projectName,
    projectAddress: "Baustelle Köln",
    status: "new",
    note: "",
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
}

describe("parseAppointmentInput", () => {
  it("prefills callback appointment with reminder from German text", () => {
    const mueller = customer("K-001", "Müller GmbH");
    const result = parseAppointmentInput(
      "Morgen um 14 Uhr Rückruf bei Müller wegen Angebot, Erinnerung 30 Minuten vorher.",
      {
        now: NOW,
        customers: [mueller],
      },
    );

    expect(result.type).toBe("callback");
    expect(result.title).toBe("Rückruf bei Müller GmbH");
    expect(result.date).toBe("2026-05-09");
    expect(result.startTime).toBe("14:00");
    expect(result.reminderEnabled).toBe(true);
    expect(result.reminderMinutesBefore).toBe(30);
    expect(result.customerMatch?.status).toBe("matched");
    expect(result.customerMatch?.id).toBe("K-001");
    expect(result.warnings).toEqual([]);
  });

  it("suggests project and location for next Monday execution", () => {
    const schneider = customer("K-002", "Schneider GmbH");
    const result = parseAppointmentInput(
      "Nächsten Montag 8 Uhr Ausführung Badezimmer bei Schneider in Köln.",
      {
        now: NOW,
        customers: [schneider],
        projects: [project("P-001", "Badezimmer sanieren", schneider)],
      },
    );

    expect(result.type).toBe("work");
    expect(result.date).toBe("2026-05-11");
    expect(result.startTime).toBe("08:00");
    expect(result.location).toBe("Köln");
    expect(result.customerMatch?.status).toBe("matched");
    expect(result.projectMatch?.status).toBe("suggested");
    expect(result.projectMatch?.id).toBe("P-001");
  });

  it("warns instead of guessing when date and time are missing", () => {
    const result = parseAppointmentInput("Rückruf bei Müller", {
      now: NOW,
      customers: [customer("K-001", "Müller GmbH")],
    });

    expect(result.type).toBe("callback");
    expect(result.date).toBe("");
    expect(result.startTime).toBe("");
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        "Datum fehlt oder ist unklar. Bitte ergänzen.",
        "Uhrzeit fehlt oder ist unklar. Bitte ergänzen.",
      ]),
    );
  });

  it("does not blindly match ambiguous customers", () => {
    const result = parseAppointmentInput("Morgen um 10 Uhr Rückruf bei Müller", {
      now: NOW,
      customers: [
        customer("K-001", "Müller GmbH"),
        customer("K-002", "Müller Sanitär"),
      ],
    });

    expect(result.customerMatch?.status).toBe("ambiguous");
    expect(result.customerMatch?.id).toBeUndefined();
    expect(result.warnings).toContain(
      "Kunde nicht eindeutig erkannt. Bitte auswählen.",
    );
  });

  it("suggests invoice documents by number", () => {
    const result = parseAppointmentInput(
      "Freitag Zahlungserinnerung für Rechnung 2044, 9 Uhr.",
      {
        now: NOW,
        documents: [
          {
            documentNumber: "RE-2026-2044",
            documentType: "invoice",
            customerName: "Müller GmbH",
            projectName: "Bad",
          },
        ],
      },
    );

    expect(result.type).toBe("payment_reminder");
    expect(result.date).toBe("2026-05-08");
    expect(result.startTime).toBe("09:00");
    expect(result.documentMatch?.status).toBe("suggested");
    expect(result.documentMatch?.id).toBe("RE-2026-2044");
    expect(result.documentMatch?.documentType).toBe("invoice");
  });
});
