"use client";
import { useState } from "react";

type OfferResult = {
  offer: { subject: string; intro: string; details: string; closing: string };
  pdfUrl: string;
};

export default function Home() {
  const [form, setForm] = useState({
    customerName: "", customerEmail: "", serviceDescription: "",
    hours: "", hourlyRate: "65", materialCost: "0",
    street: "", zip: "", city: ""
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OfferResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await fetch("/api/generate-offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: form.customerName, customerEmail: form.customerEmail,
          serviceDescription: form.serviceDescription,
          hours: Number(form.hours), hourlyRate: Number(form.hourlyRate),
          materialCost: Number(form.materialCost),
          customerAddress: { street: form.street, zip: form.zip, city: form.city }
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Fehler");
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler");
    } finally { setLoading(false); }
  };

  const net = (Number(form.hours) * Number(form.hourlyRate)) + Number(form.materialCost);
  const gross = net * 1.19;

  return (
    <div className="space-y-8">
      <div className="text-center space-y-3">
        <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-400 ring-1 ring-emerald-500/30">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          KI-Angebotsgenerator fuer Handwerker
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white">Professionelles Angebot in Sekunden</h1>
        <p className="text-slate-400 max-w-xl mx-auto">Gib deine Auftragsdaten ein, die KI schreibt das Angebot, generiert ein PDF und verschickt es direkt per E-Mail.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Kundendaten</h2>
          <div className="space-y-3">
            {[
              { name: "customerName", label: "Name / Firma *", placeholder: "Max Mustermann" },
              { name: "customerEmail", label: "E-Mail-Adresse *", placeholder: "max@beispiel.de" },
              { name: "street", label: "Strasse", placeholder: "Musterstrasse 1" },
            ].map(f => (
              <div key={f.name}>
                <label className="mb-1 block text-xs text-slate-400">{f.label}</label>
                <input name={f.name} value={(form as Record<string, string>)[f.name]} onChange={handleChange}
                  placeholder={f.placeholder}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
              </div>
            ))}
            <div className="grid grid-cols-2 gap-3">
              {[
                { name: "zip", label: "PLZ", placeholder: "12345" },
                { name: "city", label: "Stadt", placeholder: "Berlin" }
              ].map(f => (
                <div key={f.name}>
                  <label className="mb-1 block text-xs text-slate-400">{f.label}</label>
                  <input name={f.name} value={(form as Record<string, string>)[f.name]} onChange={handleChange}
                    placeholder={f.placeholder}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Auftragsdaten</h2>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Leistungsbeschreibung *</label>
            <textarea name="serviceDescription" value={form.serviceDescription} onChange={handleChange}
              rows={4} placeholder="z.B. Badezimmer komplett renovieren, Fliesen verlegen, Sanitaer erneuern ..."
              className="w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 resize-none" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { name: "hours", label: "Stunden", placeholder: "8" },
              { name: "hourlyRate", label: "Stundensatz EUR", placeholder: "65" },
              { name: "materialCost", label: "Material EUR", placeholder: "0" }
            ].map(f => (
              <div key={f.name}>
                <label className="mb-1 block text-xs text-slate-400">{f.label}</label>
                <input type="number" name={f.name} value={(form as Record<string, string>)[f.name]} onChange={handleChange}
                  placeholder={f.placeholder}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
              </div>
            ))}
          </div>
          {Number(form.hours) > 0 && (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm">
              <div className="flex justify-between text-slate-400"><span>Netto</span><span>{net.toFixed(2)} EUR</span></div>
              <div className="flex justify-between font-semibold text-emerald-400"><span>Brutto (19% MwSt.)</span><span>{gross.toFixed(2)} EUR</span></div>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      <div className="flex justify-center">
        <button onClick={handleSubmit} disabled={loading || !form.customerName || !form.customerEmail || !form.serviceDescription || !form.hours}
          className="flex items-center gap-2 rounded-xl bg-emerald-500 px-8 py-3.5 text-sm font-semibold text-slate-900 transition-all hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40">
          {loading ? (
            <><span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-900 border-t-transparent" />KI generiert Angebot ...</>
          ) : "Angebot mit KI generieren & versenden"}
        </button>
      </div>

      {result && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6 space-y-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 text-lg">✓</span>
            <h3 className="font-semibold text-emerald-400">Angebot erfolgreich erstellt und versendet!</h3>
          </div>
          <div className="space-y-3 text-sm text-slate-300">
            <div><span className="font-medium text-slate-200">Betreff:</span> {result.offer.subject}</div>
            <div><span className="font-medium text-slate-200">Anschreiben:</span> {result.offer.intro}</div>
            <div className="whitespace-pre-line"><span className="font-medium text-slate-200">Details:</span> {result.offer.details}</div>
          </div>
          <a href={result.pdfUrl} download="angebot.pdf"
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors">
            PDF herunterladen
          </a>
        </div>
      )}

      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 text-center space-y-3">
        <p className="text-sm text-slate-400">Moechtest du den vollen Zugang mit unbegrenzten Angeboten?</p>
        <a href="/api/create-checkout-session" className="inline-flex items-center gap-2 rounded-xl bg-slate-800 px-6 py-3 text-sm font-medium text-slate-200 ring-1 ring-slate-700 hover:bg-slate-700 transition-colors">
          Jetzt fuer 49 EUR/Monat freischalten
        </a>
      </div>
    </div>
  );
}