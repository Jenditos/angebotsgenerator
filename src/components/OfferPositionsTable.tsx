"use client";

import { useMemo, useState } from "react";
import { calculateOfferTotals, calculatePositionTotal } from "@/lib/offer-position-utils";
import {
  DEFAULT_SERVICE_TYPES,
  OfferPosition,
  OfferPositionsChangePayload,
  OfferTotals,
  OfferUnit
} from "@/types/offer-position";

const UNIT_OPTIONS: OfferUnit[] = ["Std.", "m²", "Stk.", "lfm", "Pauschal"];

type OfferPositionsTableProps = {
  positions: OfferPosition[];
  vatRate?: number;
  serviceTypes?: string[];
  customServiceTypes?: string[];
  onChange: (payload: OfferPositionsChangePayload) => void;
  onCustomServiceTypesChange?: (types: string[]) => void;
};

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function createEmptyPosition(): OfferPosition {
  return {
    id: crypto.randomUUID(),
    serviceType: DEFAULT_SERVICE_TYPES[0],
    description: "",
    quantity: 1,
    unit: "Std.",
    unitPrice: 0,
    totalPrice: 0
  };
}

export function OfferPositionsTable({
  positions,
  vatRate = 19,
  serviceTypes = DEFAULT_SERVICE_TYPES,
  customServiceTypes = [],
  onChange,
  onCustomServiceTypesChange
}: OfferPositionsTableProps) {
  const [newServiceType, setNewServiceType] = useState("");

  // Konfiguration: Standard-Leistungsarten + firmenspezifische Einträge im selben Dropdown.
  const mergedServiceTypes = useMemo(
    () => Array.from(new Set([...serviceTypes, ...customServiceTypes].map((item) => item.trim()).filter(Boolean))),
    [serviceTypes, customServiceTypes]
  );

  const totals: OfferTotals = useMemo(() => calculateOfferTotals(positions, vatRate), [positions, vatRate]);

  function updatePositions(nextPositions: OfferPosition[]) {
    onChange({
      positions: nextPositions,
      totals: calculateOfferTotals(nextPositions, vatRate)
    });
  }

  function updatePosition<K extends keyof OfferPosition>(id: string, key: K, value: OfferPosition[K]) {
    const nextPositions = positions.map((position) => {
      if (position.id !== id) {
        return position;
      }

      const nextPosition = {
        ...position,
        [key]: value
      };

      const quantity = key === "quantity" ? Number(value) : nextPosition.quantity;
      const unitPrice = key === "unitPrice" ? Number(value) : nextPosition.unitPrice;

      return {
        ...nextPosition,
        totalPrice: calculatePositionTotal(quantity, unitPrice)
      };
    });

    updatePositions(nextPositions);
  }

  function addRow() {
    updatePositions([...positions, createEmptyPosition()]);
  }

  function deleteRow(id: string) {
    updatePositions(positions.filter((position) => position.id !== id));
  }

  function addCustomServiceType() {
    const trimmed = newServiceType.trim();
    if (!trimmed || !onCustomServiceTypesChange) {
      return;
    }

    if (!customServiceTypes.some((item) => item.toLowerCase() === trimmed.toLowerCase())) {
      onCustomServiceTypesChange([...customServiceTypes, trimmed]);
    }
    setNewServiceType("");
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h3 className="text-lg font-semibold text-slate-900">Leistungspositionen</h3>
        <button type="button" onClick={addRow} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">
          + Zeile hinzufügen
        </button>
      </div>

      <div className="mb-4 overflow-x-auto">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-600">
              <th className="p-2">Leistungsart</th>
              <th className="p-2">Beschreibung</th>
              <th className="p-2">Menge</th>
              <th className="p-2">Einheit</th>
              <th className="p-2">Einzelpreis (€)</th>
              <th className="p-2">Gesamtpreis (€)</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {positions.map((position) => (
              <tr key={position.id} className="border-b border-slate-100 align-top">
                <td className="p-2">
                  <select
                    value={position.serviceType}
                    onChange={(event) => updatePosition(position.id, "serviceType", event.target.value)}
                    className="w-44 rounded border border-slate-300 px-2 py-1"
                  >
                    {mergedServiceTypes.map((serviceType) => (
                      <option key={serviceType} value={serviceType}>
                        {serviceType}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="p-2">
                  <input
                    value={position.description}
                    onChange={(event) => updatePosition(position.id, "description", event.target.value)}
                    className="w-72 rounded border border-slate-300 px-2 py-1"
                    placeholder="Leistung beschreiben"
                  />
                </td>
                <td className="p-2">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={position.quantity}
                    onChange={(event) => updatePosition(position.id, "quantity", toNumber(event.target.value))}
                    className="w-24 rounded border border-slate-300 px-2 py-1"
                  />
                </td>
                <td className="p-2">
                  <select
                    value={position.unit}
                    onChange={(event) => updatePosition(position.id, "unit", event.target.value as OfferUnit)}
                    className="w-24 rounded border border-slate-300 px-2 py-1"
                  >
                    {UNIT_OPTIONS.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="p-2">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={position.unitPrice}
                    onChange={(event) => updatePosition(position.id, "unitPrice", toNumber(event.target.value))}
                    className="w-28 rounded border border-slate-300 px-2 py-1"
                  />
                </td>
                <td className="p-2 font-medium text-slate-900">{position.totalPrice.toFixed(2)}</td>
                <td className="p-2">
                  <button
                    type="button"
                    onClick={() => deleteRow(position.id)}
                    className="rounded border border-rose-300 px-2 py-1 text-rose-700"
                  >
                    Löschen
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mb-4 rounded-md bg-slate-50 p-3">
        <p className="font-medium text-slate-900">Eigene Leistungsart hinzufügen</p>
        <div className="mt-2 flex gap-2">
          <input
            value={newServiceType}
            onChange={(event) => setNewServiceType(event.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1"
            placeholder="z. B. Photovoltaik"
          />
          <button type="button" onClick={addCustomServiceType} className="rounded bg-slate-700 px-3 py-1 text-white">
            Hinzufügen
          </button>
        </div>
      </div>

      <div className="ml-auto w-full max-w-xs space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-600">Zwischensumme (Netto)</span>
          <strong>{totals.netTotal.toFixed(2)} €</strong>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-600">MwSt. ({vatRate} %)</span>
          <strong>{totals.vatAmount.toFixed(2)} €</strong>
        </div>
        <div className="flex justify-between border-t border-slate-300 pt-2 text-base">
          <span>Gesamtsumme (Brutto)</span>
          <strong>{totals.grossTotal.toFixed(2)} €</strong>
        </div>
      </div>
    </section>
  );
}
