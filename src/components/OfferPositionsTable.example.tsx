"use client";

import { useMemo, useState } from "react";
import { OfferPositionsTable, createEmptyPosition } from "@/components/OfferPositionsTable";
import { OfferPosition, OfferTotals } from "@/types/offer-position";

export function OfferFormExample() {
  const [positions, setPositions] = useState<OfferPosition[]>([createEmptyPosition()]);
  const [totals, setTotals] = useState<OfferTotals>({ netTotal: 0, vatAmount: 0, grossTotal: 0 });
  const [customServiceTypes, setCustomServiceTypes] = useState<string[]>([]);

  // Beispiel für bestehende Formulare: positions -> serialisierte Leistungsbeschreibung.
  const serializedDescription = useMemo(
    () =>
      positions
        .map((position) => `${position.serviceType}: ${position.description}`.trim())
        .filter(Boolean)
        .join("; "),
    [positions]
  );

  return (
    <div className="space-y-4">
      <OfferPositionsTable
        positions={positions}
        customServiceTypes={customServiceTypes}
        onCustomServiceTypesChange={setCustomServiceTypes}
        onChange={({ positions: nextPositions, totals: nextTotals }) => {
          setPositions(nextPositions);
          setTotals(nextTotals);
        }}
      />

      <input type="hidden" name="serviceDescription" value={serializedDescription} />
      <input type="hidden" name="materialCost" value={totals.netTotal.toFixed(2)} />
    </div>
  );
}
