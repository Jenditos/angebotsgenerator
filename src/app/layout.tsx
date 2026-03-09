import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KI-Angebotsgenerator",
  description: "Angebote per KI erstellen, als PDF exportieren und versenden"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
