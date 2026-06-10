import { NextResponse } from "next/server";
import { POST as postCustomer } from "@/app/api/customers/route";
import { POST as postProject } from "@/app/api/projects/route";
import { POST as postSettings } from "@/app/api/settings/route";
import { requireAppAccess } from "@/lib/access/guards";
import { upsertStoredCustomer } from "@/server/services/customer-store-service";
import { upsertStoredProject } from "@/server/services/project-store-service";
import { writeSettings } from "@/lib/settings-store";

jest.mock("@/lib/access/guards", () => ({
  requireAppAccess: jest.fn(),
}));

jest.mock("@/server/services/customer-store-service", () => ({
  listStoredCustomers: jest.fn(),
  removeStoredCustomer: jest.fn(),
  upsertStoredCustomer: jest.fn(),
}));

jest.mock("@/server/services/project-store-service", () => ({
  listStoredProjects: jest.fn(),
  removeStoredProject: jest.fn(),
  upsertStoredProject: jest.fn(),
}));

jest.mock("@/lib/settings-store", () => ({
  readOnboardingStatus: jest.fn(),
  readSettings: jest.fn(),
  writeOnboardingStatus: jest.fn(),
  writeSettings: jest.fn(),
}));

const requireAppAccessMock = jest.mocked(requireAppAccess);
const upsertStoredCustomerMock = jest.mocked(upsertStoredCustomer);
const upsertStoredProjectMock = jest.mocked(upsertStoredProject);
const writeSettingsMock = jest.mocked(writeSettings);

function jsonRequest(pathname: string, body: unknown): Request {
  return new Request(`https://example.com${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("API input validation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    requireAppAccessMock.mockResolvedValue({
      ok: true,
      supabase: {} as never,
      user: { id: "user-1", email: "user@example.com" } as never,
      access: {} as never,
    });
  });

  it("rejects invalid customer email before storage", async () => {
    const response = await postCustomer(
      jsonRequest("/api/customers", {
        customerName: "Max Mustermann",
        street: "Musterstraße 1",
        postalCode: "12345",
        city: "Berlin",
        customerEmail: "ungueltig",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Bitte eine gültige E-Mail-Adresse angeben.",
    });
    expect(upsertStoredCustomerMock).not.toHaveBeenCalled();
  });

  it("returns a clear 400 response for malformed JSON", async () => {
    const response = await postCustomer(
      new Request("https://example.com/api/customers", {
        method: "POST",
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Die Anfrage enthält kein gültiges JSON.",
    });
    expect(upsertStoredCustomerMock).not.toHaveBeenCalled();
  });

  it("rejects oversized project notes before storage", async () => {
    const response = await postProject(
      jsonRequest("/api/projects", {
        projectName: "Umbau",
        customerName: "Muster GmbH",
        customerAddress: "Musterstraße 1, 12345 Berlin",
        projectNote: "a".repeat(5_001),
      }),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("maximal 5.000 Zeichen");
    expect(upsertStoredProjectMock).not.toHaveBeenCalled();
  });

  it("rejects invalid settings email before storage", async () => {
    const response = await postSettings(
      jsonRequest("/api/settings", { senderCopyEmail: "ungueltig" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Bitte eine gültige Absender-Kopie-E-Mail-Adresse angeben.",
    });
    expect(writeSettingsMock).not.toHaveBeenCalled();
  });

  it("passes through access failures before parsing input", async () => {
    requireAppAccessMock.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Kein Zugriff." }, { status: 503 }),
    });

    const response = await postCustomer(
      new Request("https://example.com/api/customers", {
        method: "POST",
        body: "{",
      }),
    );

    expect(response.status).toBe(503);
    expect(upsertStoredCustomerMock).not.toHaveBeenCalled();
  });
});
