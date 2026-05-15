"use client";

import { useMemo, useState } from "react";
import {
  HANDWERK_TRADE_GROUPS,
  HANDWERK_TRADE_NAMES,
  HANDWERK_TRADE_TOTAL_COUNT,
  normalizeTradeSearchValue,
  sanitizeHandwerkTradeSelections,
} from "@/lib/handwerk-trades";

type TradeMultiSelectProps = {
  selectedTrades: string[];
  onChange: (nextTrades: string[]) => void;
  idPrefix?: string;
  compact?: boolean;
  helperText?: string;
};

export function TradeMultiSelect({
  selectedTrades,
  onChange,
  idPrefix = "trade",
  compact = false,
  helperText,
}: TradeMultiSelectProps) {
  const [query, setQuery] = useState("");
  const selectedRelevantTrades = useMemo(
    () => sanitizeHandwerkTradeSelections(selectedTrades),
    [selectedTrades],
  );
  const selectedSet = useMemo(
    () => new Set(selectedRelevantTrades),
    [selectedRelevantTrades],
  );
  const normalizedQuery = normalizeTradeSearchValue(query);

  const filteredGroups = useMemo(() => {
    if (!normalizedQuery) {
      return HANDWERK_TRADE_GROUPS;
    }

    return HANDWERK_TRADE_GROUPS.map((group) => ({
      ...group,
      trades: group.trades.filter((trade) =>
        trade.searchText.includes(normalizedQuery),
      ),
    })).filter((group) => group.trades.length > 0);
  }, [normalizedQuery]);

  function toggleTrade(tradeName: string) {
    const nextSet = new Set(selectedSet);
    if (nextSet.has(tradeName)) {
      nextSet.delete(tradeName);
    } else {
      nextSet.add(tradeName);
    }

    onChange(HANDWERK_TRADE_NAMES.filter((name) => nextSet.has(name)));
  }

  return (
    <div className={`tradeMultiSelect ${compact ? "tradeMultiSelectCompact" : ""}`}>
      <div className="tradeMultiSelectHeader">
        <div>
          <strong>Gewerke auswählen</strong>
          <span>
            {selectedRelevantTrades.length > 0
              ? `${selectedRelevantTrades.length} ausgewählt`
              : "Noch kein Gewerk ausgewählt"}
          </span>
        </div>
        <small>{HANDWERK_TRADE_TOTAL_COUNT} baustellennahe Einträge</small>
      </div>

      <label className="tradeMultiSelectSearch">
        <span className="srOnly">Gewerk suchen</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Gewerk suchen, z. B. Elektrotechniker"
          autoCapitalize="words"
        />
      </label>

      {helperText ? <p className="tradeMultiSelectHelper">{helperText}</p> : null}

      <div className="tradeMultiSelectGroups">
        {filteredGroups.map((group, groupIndex) => {
          const selectedInGroup = group.trades.filter((trade) =>
            selectedSet.has(trade.name),
          ).length;

          return (
            <details
              key={group.section}
              className="tradeGroup"
              open={Boolean(normalizedQuery) || selectedInGroup > 0 || groupIndex === 0}
            >
              <summary>
                <span>{group.label}</span>
                <small>
                  {selectedInGroup > 0 ? `${selectedInGroup} / ` : ""}
                  {group.trades.length}
                </small>
              </summary>
              <p className="tradeGroupDescription">{group.description}</p>
              <div className="tradeChoiceGrid" role="group" aria-label={group.label}>
                {group.trades.map((trade) => {
                  const isSelected = selectedSet.has(trade.name);
                  return (
                    <button
                      key={trade.id}
                      id={`${idPrefix}-${trade.id}`}
                      type="button"
                      className={`tradeChoice ${isSelected ? "isSelected" : ""}`}
                      aria-pressed={isSelected}
                      onClick={() => toggleTrade(trade.name)}
                    >
                      <span>{trade.name}</span>
                      <small>{trade.section}</small>
                    </button>
                  );
                })}
              </div>
            </details>
          );
        })}
      </div>

      {filteredGroups.length === 0 ? (
        <p className="tradeMultiSelectEmpty">Kein passendes Gewerk gefunden.</p>
      ) : null}
    </div>
  );
}
