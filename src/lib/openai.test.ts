import { parseOfferIntake, parseOfferIntakeFromImage } from "@/lib/openai";

describe("parseOfferIntake fallback parsing", () => {
  const originalApiKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    process.env.OPENAI_API_KEY = originalApiKey;
  });

  it("extracts person, address and service data from a free-form dictated transcript without API key", async () => {
    delete process.env.OPENAI_API_KEY;

    const result = await parseOfferIntake(
      "Stefan Vucic am bermeshof 5 40231 Düsseldorf Stefan wucic@gmail.com ja Betonarbeiten zwei Kilogramm EP Preis 3, inklusive Verlegung von 60 x 60 Feinsteinzeug Fliesen 20 Stundensatz 22 € Materialkosten 15 €",
    );

    expect(result.usedFallback).toBe(true);
    expect(result.fallbackReason).toBe("no_api_key");
    expect(result.fields.customerType).toBe("person");
    expect(result.fields.firstName).toBe("Stefan");
    expect(result.fields.lastName).toBe("Vucic");
    expect(result.fields.street).toBe("Am Bermeshof 5");
    expect(result.fields.postalCode).toBe("40231");
    expect(result.fields.city).toBe("Düsseldorf");
    expect(result.fields.customerEmail).toBe("wucic@gmail.com");
    expect(result.fields.serviceDescription).toBe("Betonarbeiten");
    expect(result.fields.hours).toBe(20);
    expect(result.fields.hourlyRate).toBe(22);
    expect(result.fields.materialCost).toBe(15);
  });
});

describe("parseOfferIntakeFromImage fallback parsing", () => {
  const originalApiKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    process.env.OPENAI_API_KEY = originalApiKey;
  });

  it("returns no_api_key fallback when no OpenAI key is configured", async () => {
    delete process.env.OPENAI_API_KEY;

    const result = await parseOfferIntakeFromImage(
      "data:image/jpeg;base64,QUJDRA==",
    );

    expect(result.usedFallback).toBe(true);
    expect(result.fallbackReason).toBe("no_api_key");
    expect(result.fields).toEqual({});
  });
});
