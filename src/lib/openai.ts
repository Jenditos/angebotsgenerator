import OpenAI from "openai";

if (!process.env.OPENAI_API_KEY) {
  console.warn("OPENAI_API_KEY ist nicht gesetzt.");
}

export type OfferPromptInput = {
  customerName: string;
  serviceDescription: string;
  hours: number;
  hourlyRate: number;
  materialCost: number;
};

export type OfferText = {
  subject: string;
  intro: string;
  details: string;
  closing: string;
};

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function generateOfferText(input: OfferPromptInput): Promise<OfferText> {
  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: "Du bist ein deutscher Handwerksmeister, der professionelle, klare und seriose Angebote schreibt. Antworte ausschliesslich im JSON-Format." },
      { role: "user", content: `Erstelle ein professionelles deutsches Angebot:\n\nKunde: ${input.customerName}\nLeistung: ${input.serviceDescription}\nStunden: ${input.hours}\nStundensatz: ${input.hourlyRate} EUR\nMaterialkosten: ${input.materialCost} EUR\n\nJSON-Schema: { "subject": "...", "intro": "...", "details": "...", "closing": "..." }` }
    ],
    response_format: { type: "json_object" }
  });
  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error("Kein Inhalt von OpenAI erhalten.");
  return JSON.parse(raw) as OfferText;
}