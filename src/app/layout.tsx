import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KI-Angebotsgenerator fuer Handwerker",
  description: "Erstelle in Sekunden professionelle Angebote mit KI, PDF und E-Mail-Versand."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body className="min-h-screen bg-slate-950 text-slate-50 antialiased">
        <div className="flex min-h-screen flex-col">
          <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur">
            <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 text-sm font-bold text-slate-900">KI</div>
                <span className="text-sm font-medium text-slate-300">Angebotsgenerator fuer Handwerker</span>
              </div>
              <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400 ring-1 ring-emerald-500/40">49 € / Monat</span>
            </div>
          </header>
          <main className="flex-1"><div className="mx-auto max-w-4xl px-4 py-8">{children}</div></main>
          <footer className="border-t border-slate-800 bg-slate-950/80">
            <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4 text-xs text-slate-500">
              <span>© {new Date().getFullYear()} KI-Angebotsgenerator</span>
              <span>Next.js, OpenAI, Stripe, Supabase & Resend</span>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}