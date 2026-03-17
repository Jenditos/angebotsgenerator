"use client";

import { useMemo, useState } from "react";
import { calculateOfferTotals, calculatePositionTotal, normalizeOfferPosition } from "@/lib/offer-position-utils";
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

function createId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `position-${Date.now()}-${Math.round(Math.random() * 10_000)}`;
}

export function createEmptyPosition(serviceType = DEFAULT_SERVICE_TYPES[0]): OfferPosition {
  return {
    id: createId(),
    serviceType,
    description: "",
    quantity: 1,
    unit: "Std.",
    unitPrice: 0,
    totalPrice: calculatePositionTotal(1, 0)
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
  const [searchByRowId, setSearchByRowId] = useState<Record<string, string>>({});
  const [openRowId, setOpenRowId] = useState<string | null>(null);

  // Konfiguration: vordefinierte + firmenspezifische Leistungsarten werden zusammengeführt
  // und dann pro Zeile im Typeahead anhand der Eingabe gefiltert.
  const mergedServiceTypes = useMemo(
    () =>
      Array.from(new Set([...serviceTypes, ...customServiceTypes].map((item) => item.trim()).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, "de")
      ),
    [serviceTypes, customServiceTypes]
  );

  const totals: OfferTotals = useMemo(() => calculateOfferTotals(positions, vatRate), [positions, vatRate]);

  function updatePositions(nextPositions: OfferPosition[]) {
    const normalized = nextPositions.map(normalizeOfferPosition);
    onChange({
      positions: normalized,
      totals: calculateOfferTotals(normalized, vatRate)
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
    const firstServiceType = mergedServiceTypes[0] ?? DEFAULT_SERVICE_TYPES[0];
    updatePositions([...positions, createEmptyPosition(firstServiceType)]);
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

  function getFilteredServiceTypes(rowId: string, currentServiceType: string): string[] {
    const query = (searchByRowId[rowId] ?? currentServiceType).toLowerCase().trim();
    if (!query) {
      return mergedServiceTypes;
    }

    return mergedServiceTypes.filter((serviceType) => serviceType.toLowerCase().includes(query));
  }

  return (
    <section className="positionsCard">
      <div className="positionsHeader">
        <h3>Leistungspositionen</h3>
        <button type="button" onClick={addRow} className="ghostButton positionsAddButton">
          + Zeile hinzufügen
        </button>
      </div>

      <div className="positionsTableWrap">
        <table className="positionsTable">
          <thead>
            <tr>
              <th>Leistungsart</th>
              <th>Beschreibung</th>
              <th>Menge</th>
              <th>Einheit</th>
              <th>Einzelpreis (€)</th>
              <th>Gesamtpreis (€)</th>
              <th aria-label="Aktionen" />
            </tr>
          </thead>
          <tbody>
            {positions.map((position) => {
              const filteredTypes = getFilteredServiceTypes(position.id, position.serviceType);

              return (
                <tr key={position.id}>
                  <td>
                    <div className="positionsTypeahead">
                      <input
                        value={searchByRowId[position.id] ?? position.serviceType}
                        onFocus={() => setOpenRowId(position.id)}
                        onBlur={() => setTimeout(() => setOpenRowId((prev) => (prev === position.id ? null : prev)), 100)}
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          setSearchByRowId((prev) => ({ ...prev, [position.id]: nextValue }));
                          updatePosition(position.id, "serviceType", nextValue);
                          setOpenRowId(position.id);
                        }}
                        placeholder="Leistungsart suchen"
                      />
                      {openRowId === position.id ? (
                        <ul className="positionsTypeaheadList">
                          {filteredTypes.length === 0 ? (
                            <li className="positionsTypeaheadEmpty">Keine Treffer</li>
                          ) : (
                            filteredTypes.slice(0, 30).map((serviceType) => (
                              <li key={serviceType}>
                                <button
                                  type="button"
                                  onMouseDown={() => {
                                    updatePosition(position.id, "serviceType", serviceType);
                                    setSearchByRowId((prev) => ({ ...prev, [position.id]: serviceType }));
                                    setOpenRowId(null);
                                  }}
                                >
                                  {serviceType}
                                </button>
                              </li>
                            ))
                          )}
                        </ul>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <input
                      value={position.description}
                      onChange={(event) => updatePosition(position.id, "description", event.target.value)}
                      placeholder="Leistung beschreiben"
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={position.quantity}
                      onChange={(event) => updatePosition(position.id, "quantity", toNumber(event.target.value))}
                    />
                  </td>
                  <td>
                    <select
                      value={position.unit}
                      onChange={(event) => updatePosition(position.id, "unit", event.target.value as OfferUnit)}
                    >
                      {UNIT_OPTIONS.map((unit) => (
                        <option key={unit} value={unit}>
                          {unit}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={position.unitPrice}
                      onChange={(event) => updatePosition(position.id, "unitPrice", toNumber(event.target.value))}
                    />
                  </td>
                  <td className="positionsPrice">{position.totalPrice.toFixed(2)}</td>
                  <td>
                    <button type="button" onClick={() => deleteRow(position.id)} className="positionsDeleteButton">
                      Löschen
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="positionsCustomCard">
        <p>Eigene Leistungsart hinzufügen</p>
        <div className="positionsCustomRow">
          <input
            value={newServiceType}
            onChange={(event) => setNewServiceType(event.target.value)}
            placeholder="z. B. Poolbau"
          />
          <button type="button" onClick={addCustomServiceType} className="primaryButton">
            Hinzufügen
          </button>
        </div>
      </div>

      <div className="positionsTotals">
        <div>
          <span>Zwischensumme (Netto)</span>
          <strong>{totals.netTotal.toFixed(2)} €</strong>
        </div>
        <div>
          <span>MwSt. ({vatRate} %)</span>
          <strong>{totals.vatAmount.toFixed(2)} €</strong>
        </div>
        <div className="positionsGrandTotal">
          <span>Gesamtsumme (Brutto)</span>
          <strong>{totals.grossTotal.toFixed(2)} €</strong>
        </div>
      </div>
    </section>
  );
}
