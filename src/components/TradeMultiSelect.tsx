"use client";

import { useMemo, useState } from "react";
import {
  HANDWERK_TRADE_GROUPS,
  HANDWERK_TRADE_NAMES,
  HANDWERK_TRADE_TOTAL_COUNT,
  type HandwerkTrade,
  normalizeTradeSearchValue,
  sanitizeHandwerkTradeSelections,
} from "@/lib/handwerk-trades";

type TradeMultiSelectProps = {
  selectedTrades: string[];
  onChange: (nextTrades: string[]) => void;
  idPrefix?: string;
  compact?: boolean;
  helperText?: string;
  variant?: "default" | "onboarding";
};

const FEATURED_TRADE_OPTIONS = [
  { label: "Maler und Lackierer", tradeName: "Maler und Lackierer" },
  {
    label: "Sanitär, Heizung, Klima",
    tradeName: "Installateur und Heizungsbauer",
  },
  { label: "Elektro", tradeName: "Elektrotechniker" },
  { label: "Tischler / Schreiner", tradeName: "Tischler" },
  { label: "Trockenbau", tradeName: "Stuckateure" },
  { label: "Bodenleger", tradeName: "Bodenleger" },
  { label: "Dachdecker", tradeName: "Dachdecker" },
  {
    label: "Garten- und Landschaftsbau",
    tradeName: "Garten- und Landschaftsbau",
  },
  { label: "Fliesenleger", tradeName: "Fliesen-, Platten- und Mosaikleger" },
  { label: "Maurer / Bauunternehmen", tradeName: "Maurer und Betonbauer" },
];

export function TradeMultiSelect({
  selectedTrades,
  onChange,
  idPrefix = "trade",
  compact = false,
  helperText,
  variant = "default",
}: TradeMultiSelectProps) {
  const [query, setQuery] = useState("");
  const [isFullListOpen, setIsFullListOpen] = useState(false);
  const selectedRelevantTrades = useMemo(
    () => sanitizeHandwerkTradeSelections(selectedTrades),
    [selectedTrades],
  );
  const selectedSet = useMemo(
    () => new Set(selectedRelevantTrades),
    [selectedRelevantTrades],
  );
  const normalizedQuery = normalizeTradeSearchValue(query);
  const allTrades = useMemo(
    () => HANDWERK_TRADE_GROUPS.flatMap((group) => group.trades),
    [],
  );
  const featuredTrades = useMemo(() => {
    const byName = new Map(allTrades.map((trade) => [trade.name, trade]));

    return FEATURED_TRADE_OPTIONS.map((option) => {
      const trade = byName.get(option.tradeName);
      return trade ? { ...option, trade } : null;
    }).filter(
      (option): option is { label: string; tradeName: string; trade: HandwerkTrade } =>
        Boolean(option),
    );
  }, [allTrades]);
  const searchResults = useMemo(() => {
    if (!normalizedQuery) {
      return [];
    }

    return allTrades
      .filter((trade) => trade.searchText.includes(normalizedQuery))
      .slice(0, 18);
  }, [allTrades, normalizedQuery]);

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

  const hasQuery = normalizedQuery.length > 0;
  const shouldShowFullList = isFullListOpen && !hasQuery;
  const isOnboardingVariant = variant === "onboarding";
  const shouldShowSearch = !isOnboardingVariant || isFullListOpen || hasQuery;
  const featuredTradeNames = new Set(
    featuredTrades.map(({ trade }) => trade.name),
  );
  const shouldShowSelectedChips =
    selectedRelevantTrades.length > 0 &&
    (!isOnboardingVariant ||
      selectedRelevantTrades.some((tradeName) => !featuredTradeNames.has(tradeName)));

  return (
    <div
      className={`tradeMultiSelect ${compact ? "tradeMultiSelectCompact" : ""} ${
        isOnboardingVariant ? "tradeMultiSelectOnboarding" : ""
      }`}
    >
      {!isOnboardingVariant ? (
        <div className="tradeMultiSelectHeader">
          <div>
            <strong>Gewerke auswählen</strong>
            <span>
              {selectedRelevantTrades.length > 0
                ? `${selectedRelevantTrades.length} ausgewählt`
                : "Noch kein Gewerk ausgewählt"}
            </span>
          </div>
          <small>{HANDWERK_TRADE_TOTAL_COUNT} baustellennahe Gewerke</small>
        </div>
      ) : null}

      {shouldShowSelectedChips ? (
        <div className="tradeSelectedChips" aria-label="Ausgewählte Gewerke">
          {selectedRelevantTrades.map((tradeName) => (
            <button
              key={tradeName}
              type="button"
              className="tradeSelectedChip"
              onClick={() => toggleTrade(tradeName)}
              aria-label={`${tradeName} entfernen`}
            >
              <span>{tradeName}</span>
              <strong aria-hidden="true">×</strong>
            </button>
          ))}
        </div>
      ) : null}

      {shouldShowSearch ? (
        <label className="tradeMultiSelectSearch">
          <span className="srOnly">Gewerk suchen</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Gewerk suchen, z. B. Elektrotechniker"
            autoCapitalize="words"
          />
        </label>
      ) : null}

      {helperText && !hasQuery ? (
        <p className="tradeMultiSelectHelper">{helperText}</p>
      ) : null}

      {!hasQuery ? (
        <section className="tradeQuickSection" aria-label="Häufig gewählte Gewerke">
          {!isOnboardingVariant ? (
            <div className="tradeQuickHeader">
              <p className="tradeQuickTitle">Häufig gewählt</p>
              <button
                type="button"
                className="tradeShowAllButton"
                onClick={() => setIsFullListOpen((current) => !current)}
              >
                {isFullListOpen ? "Liste einklappen" : "Alle Gewerke anzeigen"}
              </button>
            </div>
          ) : null}
          <div className="tradeQuickGrid">
            {featuredTrades.map(({ label, trade }) => {
              const isSelected = selectedSet.has(trade.name);
              return (
                <button
                  key={trade.id}
                  type="button"
                  className={`tradeChoice tradeChoiceFeatured ${
                    isSelected ? "isSelected" : ""
                  }`}
                  aria-pressed={isSelected}
                  onClick={() => toggleTrade(trade.name)}
                  title={trade.name}
                >
                  <span>{label}</span>
                  <small>{trade.section}</small>
                </button>
              );
            })}
            {isOnboardingVariant ? (
              <button
                type="button"
                className={`tradeChoice tradeChoiceFeatured tradeChoiceMore ${
                  isFullListOpen ? "isExpanded" : ""
                }`}
                aria-expanded={isFullListOpen}
                onClick={() => setIsFullListOpen((current) => !current)}
              >
                <span>{isFullListOpen ? "Liste einklappen" : "Sonstiges Gewerk"}</span>
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {hasQuery ? (
        <section className="tradeSearchResults" aria-label="Suchergebnisse">
          <p className="tradeSearchResultTitle">
            {searchResults.length > 0
              ? "Passende Gewerke"
              : "Kein passendes Gewerk gefunden"}
          </p>
          {searchResults.length > 0 ? (
            <div className="tradeChoiceGrid">
              {searchResults.map((trade) => {
                const isSelected = selectedSet.has(trade.name);
                return (
                  <button
                    key={trade.id}
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
          ) : null}
        </section>
      ) : null}

      {shouldShowFullList ? (
        <div className="tradeMultiSelectGroups">
          {filteredGroups.map((group) => {
            const selectedInGroup = group.trades.filter((trade) =>
              selectedSet.has(trade.name),
            ).length;

            return (
              <details
                key={group.section}
                className="tradeGroup"
                open={selectedInGroup > 0}
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
      ) : null}
    </div>
  );
}
