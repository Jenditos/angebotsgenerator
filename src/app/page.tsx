"use client";
import { useState } from "react";

type OfferResult = {
  offer: { subject: string; intro: string; details: string; closing: string };
  pdfUrl: string;
};

export default function Home() {
  const [formData, setFormData] = useState({
    customerName: "", customerEmail: "", serviceDescription: "",
    hours: 8, hourlyRate: 65, materialCost: 0,
    street: "", zip: "", city: ""
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OfferResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!formData.customerName || !formData.customerEmail || !formData.serviceDescription) {
      setError("Bitte fulle alle Pflichtfelder aus."); return;
    }
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await fetch("/api/generate-offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formData, customerAddress: { street: formData.street, zip: formData.zip, city: formData.city } })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Fehler beim Generieren");
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler");
    } finally { setLoading(false); }
  };

  return (
    <div className="space-y-8">
      <div className="text-center space-y-3">
        <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-4 py-1.5 text-sm font-medium text-emerald-400 ring-1 ring-emerald-500/30">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          KI-gestutzt
        </div>
        <h1 className="text-3xl font-bold text-slate-50">Angebot in Sekunden erstellen</h1>
        <p className="text-slate-400 max-w-lg mx-auto">Gib die Auftragsdaten ein — die KI schreibt das Angebot, erstellt das PDF und verschickt es per E-Mail.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-6">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">Kundendaten</h2>
          <div className="space-y-3">
            {[
              { key: "customerName", label: "Name *", placeholder: "Max Mustermann", type: "text" },
              { key: "customerEmail", label: "E-Mail *", placeholder: "max@beispiel.de", type: "email" },
              { key: "street", label: "Strasse", placeholder: "Musterstrasse 1", type: "text" },
            ].map(({ key, label, placeholder, type }) => (
              <div key={key}>
                <label className="block text-xs font-medium text-slate-400 mb-1">{label}</label>
                <input type={type} placeholder={placeholder} value={(formData as any)[key]}
                  onChange={e => setFormData(p => ({ ...p, [key]: e.target.value }))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
              </div>
            ))}
            <div className="grid grid-cols-2 gap-3">
              {[
                { key: "zip", label: "PLZ", placeholder: "12345" },
                { key: "city", label: "Stadt", placeholder: "Musterstadt" }
              ].map(({ key, label, placeholder }) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-slate-400 mb-1">{label}</label>
                  <input type="text" placeholder={placeholder} value={(formData as any)[key]}
                    onChange={e => setFormData(p => ({ ...p, [key]: e.target.value }))}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-6">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">Auftragsdaten</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Leistungsbeschreibung *</label>
              <textarea placeholder="z.B. Badezimmer renovieren: Fliesen legen, Sanitaranlagen installieren" value={formData.serviceDescription}
                onChange={e => setFormData(p => ({ ...p, serviceDescription: e.target.value }))} rows={3}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 resize-none" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { key: "hours", label: "Stunden", min: 1, step: 0.5 },
                { key: "hourlyRate", label: "Stundensatz (EUR)", min: 1, step: 1 },
                { key: "materialCost", label: "Material (EUR)", min: 0, step: 10 }
              ].map(({ key, label, min, step }) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-slate-400 mb-1">{label}</label>
                  <input type="number" min={min} step={step} value={(formData as any)[key]}
                    onChange={e => setFormData(p => ({ ...p, [key]: parseFloat(e.target.value) || 0 }))}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                </div>
              ))}
            </div>
            <div className="rounded-lg bg-slate-800/60 p-3 border border-slate-700">
              <div className="flex justify-between text-xs text-slate-400 mb-1">
                <span>Arbeitskosten: {(formData.hours * formData.hourlyRate).toFixed(2)} EUR</span>
                <span>Material: {formData.materialCost.toFixed(2)} EUR</span>
              </div>
              <div className="flex justify-between text-sm font-semibold text-emerald-400">
                <span>Gesamt (inkl. 19% MwSt.)</span>
                <span>{((formData.hours * formData.hourlyRate + formData.materialCost) * 1.19).toFixed(2)} EUR</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-800/50 bg-red-900/20 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      <div className="flex flex-col items-center gap-4">
        <button onClick={handleSubmit} disabled={loading}
          className="rounded-xl bg-emerald-500 px-8 py-3.5 text-sm font-semibold text-slate-900 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150 shadow-lg shadow-emerald-500/20">
          {loading ? (
            <span className="flex items-center gap-2"><span className="h-4 w-4 rounded-full border-2 border-slate-900/30 border-t-slate-900 animate-spin" />Angebot wird erstellt...</span>
          ) : "Angebot jetzt generieren"}
        </button>
        <button onClick={() => { const url = "/api/create-checkout-session"; const form = document.createElement("form"); form.method = "POST"; form.action = url; document.body.appendChild(form); form.submit(); }}
          className="text-xs text-slate-500 hover:text-slate-400 underline underline-offset-2 transition-colors">
          Jetzt abonnieren — 49 EUR/Monat
        </button>
      </div>

      {result && (
        <div className="rounded-xl border border-emerald-800/50 bg-emerald-900/10 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-emerald-400 uppercase tracking-wide">Angebot erstellt</h3>
            <a href={result.pdfUrl} download="angebot.pdf"
              className="rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/30 transition-colors">
              PDF herunterladen
            </a>
          </div>
          <div className="space-y-3 text-sm text-slate-300">
            <div><span className="text-slate-500 text-xs uppercase tracking-wide block mb-1">Betreff</span>{result.offer.subject}</div>
            <div><span className="text-slate-500 text-xs uppercase tracking-wide block mb-1">Einleitung</span>{result.offer.intro}</div>
            <div><span className="text-slate-500 text-xs uppercase tracking-wide block mb-1">Details</span>{result.offer.details}</div>
            <div><span className="text-slate-500 text-xs uppercase tracking-wide block mb-1">Abschluss</span>{result.offer.closing}</div>
          </div>
          <p className="text-xs text-slate-500 border-t border-slate-700 pt-3">Das Angebot wurde als PDF erstellt und per E-Mail an {formData.customerEmail} gesendet.</p>
        </div>
      )}
    </div>
  );
}