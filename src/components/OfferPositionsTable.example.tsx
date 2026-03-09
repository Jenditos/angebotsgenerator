"use client";

import { useMemo, useState } from "react";
import { OfferPositionsTable, createEmptyPosition } from "@/components/OfferPositionsTable";
import { OfferPosition } from "@/types/offer-position";

export function OfferFormExample() {
  const [positions, setPositions] = useState<OfferPosition[]>([createEmptyPosition()]);
  const [customServiceTypes, setCustomServiceTypes] = useState<string[]>([]);

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
        onChange={({ positions: nextPositions }) => {
          setPositions(nextPositions);
        }}
      />

      <input type="hidden" name="serviceDescription" value={serializedDescription} />
    </div>
  );
}
