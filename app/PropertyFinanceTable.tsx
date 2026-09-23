"use client";

import { useMemo, useState } from "react";
import { fillRateBadgeStyle, formatEuros, formatPercent, MONTH_LABELS_SHORT } from "@/lib/format";
import type { PropertyMonthlyResult } from "@/lib/vrplatform";
import type { RentType } from "@/lib/types";

type SortKey =
  | "reference"
  | "fillRate"
  | "rents"
  | "channelFees"
  | "cityTax"
  | "transferFees"
  | "netRevenue"
  | "commission"
  | "fixedRent"
  | "profit"
  | "cleaningProfit";

const RENT_TYPE_LABELS: Record<RentType, string> = {
  fixe: "Fixe",
  variable: "Variable",
  fixe_variable: "Fixe + variable",
};

interface PropertyOption {
  id: string;
  reference: string;
  tags: string[];
  rentType: RentType | null;
}

interface CleaningApiResult {
  propertyId: string;
  checkoutDates: string[];
  cleaningFeeCustomField: number | null;
  cleaningFeeGuesty: number | null;
}

interface FinanceRow {
  propertyId: string;
  reference: string;
  notFoundReferences: string[];
  isFixedRent: boolean;
  fillRate: number;
  rentsCents: number;
  channelFeesCents: number;
  cityTaxCents: number;
  transferFeesCents: number;
  netRevenueCents: number;
  commissionCents: number | null;
  fixedRentCents: number | null;
  profitCents: number | null;
  cleaningProfitCents: number | null;
}

function toRow(property: PropertyMonthlyResult, selectedMonths: number[], cleaning?: CleaningApiResult): FinanceRow {
  const selected = property.months.filter((m) => selectedMonths.includes(m.month));
  const fillRate = selected.length > 0 ? selected.reduce((sum, m) => sum + m.fillRate, 0) / selected.length : 0;
  const rentsCents = selected.reduce((sum, m) => sum + m.rentsCents, 0);
  const channelFeesCents = selected.reduce((sum, m) => sum + m.channelFeesCents, 0);
  const cityTaxCents = selected.reduce((sum, m) => sum + m.cityTaxCents, 0);
  const transferFeesCents = selected.reduce((sum, m) => sum + m.transferFeesCents, 0);
  const netRevenueCents = selected.reduce((sum, m) => sum + m.netRevenueCents, 0);
  const commissionCents =
    !property.isFixedRent && property.commissionPercent != null
      ? Math.round((netRevenueCents * property.commissionPercent) / 100)
      : null;
  const fixedRentCents =
    property.isFixedRent && property.fixedRentAmountCents != null
      ? property.fixedRentAmountCents * selectedMonths.length
      : null;
  const checkoutCount = cleaning?.checkoutDates.length ?? 0;
  const cleaningProductGuesty = cleaning?.cleaningFeeGuesty != null ? checkoutCount * cleaning.cleaningFeeGuesty : null;
  const cleaningProductCustom = cleaning?.cleaningFeeCustomField != null ? checkoutCount * cleaning.cleaningFeeCustomField : null;
  const cleaningProfitCents =
    cleaningProductGuesty != null && cleaningProductCustom != null
      ? Math.round((cleaningProductGuesty - cleaningProductCustom) * 100)
      : null;

  // Profit = (Commission, ou Net Revenue − Loyer fixe pour le modèle fixe) + City Tax + Profit ménage.
  const baseProfitCents = property.isFixedRent
    ? fixedRentCents != null
      ? netRevenueCents - fixedRentCents
      : null
    : commissionCents;
  const profitCents = baseProfitCents != null ? baseProfitCents + cityTaxCents + (cleaningProfitCents ?? 0) : null;

  return {
    propertyId: property.propertyId,
    reference: property.reference,
    notFoundReferences: property.notFoundReferences,
    isFixedRent: property.isFixedRent,
    fillRate,
    rentsCents,
    channelFeesCents,
    cityTaxCents,
    transferFeesCents,
    netRevenueCents,
    commissionCents,
    fixedRentCents,
    profitCents,
    cleaningProfitCents,
  };
}

function Money({ cents, bold = false }: { cents: number | null; bold?: boolean }) {
  if (cents == null) return <span className="text-[#6e6e73]">—</span>;
  return <span className={bold ? "font-semibold" : undefined}>{formatEuros(cents / 100)}</span>;
}

function SortHeader({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
  align = "right",
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  direction: "asc" | "desc";
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const isActive = activeKey === sortKey;
  return (
    <th className={`py-2 px-2.5 first:pl-3 last:pr-3 ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 text-[12px] font-medium transition ${
          align === "right" ? "flex-row-reverse" : ""
        } ${isActive ? "text-[#1d1d1f]" : "text-[#86868b] hover:text-[#1d1d1f]"}`}
      >
        {label}
        {isActive && <span aria-hidden>{direction === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}

export function PropertyFinanceTable({ properties: unsortedProperties }: { properties: PropertyOption[] }) {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 4 + i);
  const allProperties = useMemo(
    () => [...unsortedProperties].sort((a, b) => a.reference.localeCompare(b.reference, "fr")),
    [unsortedProperties]
  );
  const allTags = useMemo(
    () => Array.from(new Set(allProperties.flatMap((p) => p.tags))).sort((a, b) => a.localeCompare(b, "fr")),
    [allProperties]
  );

  const [year, setYear] = useState(currentYear);
  const [selectedMonths, setSelectedMonths] = useState<number[]>([new Date().getMonth() + 1]);
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>(() => allProperties.map((p) => p.id));
  const [showProperties, setShowProperties] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedRentTypes, setSelectedRentTypes] = useState<RentType[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("reference");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [results, setResults] = useState<PropertyMonthlyResult[] | null>(null);
  const [cleaningResults, setCleaningResults] = useState<CleaningApiResult[] | null>(null);
  const [removedRowIds, setRemovedRowIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matchingProperties = useMemo(() => {
    return allProperties.filter((p) => {
      const isSelected = selectedPropertyIds.includes(p.id);
      const matchesTags = selectedTags.length === 0 || p.tags.some((t) => selectedTags.includes(t));
      const matchesRentType = selectedRentTypes.length === 0 || (p.rentType != null && selectedRentTypes.includes(p.rentType));
      return isSelected && matchesTags && matchesRentType;
    });
  }, [allProperties, selectedPropertyIds, selectedTags, selectedRentTypes]);

  function toggleMonth(month: number) {
    setSelectedMonths((prev) =>
      prev.includes(month) ? prev.filter((m) => m !== month) : [...prev, month].sort((a, b) => a - b)
    );
  }

  function toggleProperty(id: string) {
    setSelectedPropertyIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  function toggleTag(tag: string) {
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  function toggleRentType(rentType: RentType) {
    setSelectedRentTypes((prev) => (prev.includes(rentType) ? prev.filter((t) => t !== rentType) : [...prev, rentType]));
  }

  async function load() {
    if (selectedMonths.length === 0) {
      setError("Sélectionne au moins un mois.");
      return;
    }
    if (matchingProperties.length === 0) {
      setError("Aucun bien ne correspond aux filtres.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const propertyIds = matchingProperties.map((p) => p.id).join(",");
      const monthlyParams = new URLSearchParams({ year: String(year), propertyIds });
      const cleaningParams = new URLSearchParams({ year: String(year), months: selectedMonths.join(","), propertyIds });
      const [monthlyRes, cleaningRes] = await Promise.all([
        fetch(`/api/finance/monthly?${monthlyParams.toString()}`),
        fetch(`/api/finance/cleaning?${cleaningParams.toString()}`),
      ]);
      const monthlyData = await monthlyRes.json();
      if (monthlyData.error) {
        setError(monthlyData.error);
        setResults(null);
        setCleaningResults(null);
      } else {
        setResults(monthlyData.properties);
        // Le profit ménage dépend de Guesty, optionnel : une erreur ici (pas
        // configuré, etc.) n'empêche pas d'afficher le reste du tableau.
        const cleaningData = await cleaningRes.json();
        setCleaningResults(cleaningData.error ? null : cleaningData.properties);
        setRemovedRowIds(new Set());
      }
    } catch {
      setError("Impossible de charger les données financières.");
    } finally {
      setLoading(false);
    }
  }

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDirection(key === "reference" ? "asc" : "desc");
    }
  }

  const cleaningByPropertyId = useMemo(
    () => new Map((cleaningResults ?? []).map((c) => [c.propertyId, c])),
    [cleaningResults]
  );
  const rows =
    results
      ?.filter((r) => !removedRowIds.has(r.propertyId))
      .map((r) => toRow(r, selectedMonths, cleaningByPropertyId.get(r.propertyId))) ?? null;

  function removeRow(propertyId: string) {
    setRemovedRowIds((prev) => new Set(prev).add(propertyId));
  }

  const sortedRows = rows
    ? [...rows].sort((a, b) => {
        let cmp: number;
        switch (sortKey) {
          case "reference":
            cmp = a.reference.localeCompare(b.reference, "fr");
            break;
          case "fillRate":
            cmp = a.fillRate - b.fillRate;
            break;
          case "rents":
            cmp = a.rentsCents - b.rentsCents;
            break;
          case "channelFees":
            cmp = a.channelFeesCents - b.channelFeesCents;
            break;
          case "cityTax":
            cmp = a.cityTaxCents - b.cityTaxCents;
            break;
          case "transferFees":
            cmp = a.transferFeesCents - b.transferFeesCents;
            break;
          case "netRevenue":
            cmp = a.netRevenueCents - b.netRevenueCents;
            break;
          case "commission":
            cmp = (a.commissionCents ?? 0) - (b.commissionCents ?? 0);
            break;
          case "fixedRent":
            cmp = (a.fixedRentCents ?? 0) - (b.fixedRentCents ?? 0);
            break;
          case "profit":
            cmp = (a.profitCents ?? 0) - (b.profitCents ?? 0);
            break;
          case "cleaningProfit":
            cmp = (a.cleaningProfitCents ?? 0) - (b.cleaningProfitCents ?? 0);
            break;
        }
        return direction === "asc" ? cmp : -cmp;
      })
    : null;

  const totals = sortedRows
    ? {
        fillRate: sortedRows.length > 0 ? sortedRows.reduce((sum, r) => sum + r.fillRate, 0) / sortedRows.length : 0,
        rentsCents: sortedRows.reduce((sum, r) => sum + r.rentsCents, 0),
        channelFeesCents: sortedRows.reduce((sum, r) => sum + r.channelFeesCents, 0),
        cityTaxCents: sortedRows.reduce((sum, r) => sum + r.cityTaxCents, 0),
        transferFeesCents: sortedRows.reduce((sum, r) => sum + r.transferFeesCents, 0),
        netRevenueCents: sortedRows.reduce((sum, r) => sum + r.netRevenueCents, 0),
        commissionCents: sortedRows.reduce((sum, r) => sum + (r.commissionCents ?? 0), 0),
        fixedRentCents: sortedRows.reduce((sum, r) => sum + (r.fixedRentCents ?? 0), 0),
        profitCents: sortedRows.reduce((sum, r) => sum + (r.profitCents ?? 0), 0),
        cleaningProfitCents: sortedRows.reduce((sum, r) => sum + (r.cleaningProfitCents ?? 0), 0),
      }
    : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="field-label" htmlFor="finance-year">
            Année
          </label>
          <select
            id="finance-year"
            value={year}
            onChange={(e) => setYear(Number.parseInt(e.target.value, 10))}
            className="mt-1 rounded-[10px] border border-black/10 bg-white px-3 py-2 text-[14px] text-[#1d1d1f] shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus:border-[#0071e3] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>

        <div>
          <span className="field-label">Mois</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {MONTH_LABELS_SHORT.map((label, i) => {
              const month = i + 1;
              const active = selectedMonths.includes(month);
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => toggleMonth(month)}
                  className={`rounded-[8px] border px-2.5 py-1.5 text-[13px] font-medium transition ${
                    active
                      ? "border-[#0071e3] bg-[#0071e3] text-white"
                      : "border-black/10 bg-white text-[#1d1d1f] hover:bg-black/[0.04]"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <button type="button" onClick={load} disabled={loading} className="btn-secondary btn-sm">
          {loading ? "Chargement…" : results ? "Actualiser" : "Charger"}
        </button>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <span className="field-label">Biens</span>
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-[#6e6e73]">
              {selectedPropertyIds.length}/{allProperties.length}
            </span>
            <button
              type="button"
              onClick={() => setShowProperties((v) => !v)}
              className="text-[12px] font-medium text-[#0071e3] hover:underline"
            >
              {showProperties ? "Masquer" : "Choisir les biens"}
            </button>
          </div>
        </div>
        {showProperties && (
          <>
            <div className="mt-1 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSelectedPropertyIds(allProperties.map((p) => p.id))}
                className="text-[12px] font-medium text-[#0071e3] hover:underline"
              >
                Tout sélectionner
              </button>
              <button
                type="button"
                onClick={() => setSelectedPropertyIds([])}
                className="text-[12px] font-medium text-[#0071e3] hover:underline"
              >
                Tout désélectionner
              </button>
            </div>
            <div className="mt-1 grid max-h-56 grid-cols-2 gap-x-4 gap-y-1 overflow-y-auto rounded-[10px] border border-black/10 bg-white p-3 sm:grid-cols-3 md:grid-cols-4">
              {allProperties.map((p) => (
                <label key={p.id} className="flex items-center gap-1.5 text-[13px] text-[#1d1d1f]">
                  <input
                    type="checkbox"
                    checked={selectedPropertyIds.includes(p.id)}
                    onChange={() => toggleProperty(p.id)}
                    className="h-3.5 w-3.5 rounded border-black/20 text-[#0071e3] focus:ring-[#0071e3]/40"
                  />
                  {p.reference}
                </label>
              ))}
            </div>
          </>
        )}
      </div>

      <div>
        <span className="field-label">Modèle de rémunération</span>
        <div className="mt-1 flex flex-wrap gap-1">
          {(Object.keys(RENT_TYPE_LABELS) as RentType[]).map((rentType) => {
            const active = selectedRentTypes.includes(rentType);
            return (
              <button
                key={rentType}
                type="button"
                onClick={() => toggleRentType(rentType)}
                className={`rounded-full border px-2.5 py-1 text-[13px] font-medium transition ${
                  active
                    ? "border-[#0071e3] bg-[#0071e3] text-white"
                    : "border-black/10 bg-white text-[#1d1d1f] hover:bg-black/[0.04]"
                }`}
              >
                {RENT_TYPE_LABELS[rentType]}
              </button>
            );
          })}
        </div>
      </div>

      {allTags.length > 0 && (
        <div>
          <span className="field-label">Tags</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {allTags.map((tag) => {
              const active = selectedTags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={`rounded-full border px-2.5 py-1 text-[13px] font-medium transition ${
                    active
                      ? "border-[#0071e3] bg-[#0071e3] text-white"
                      : "border-black/10 bg-white text-[#1d1d1f] hover:bg-black/[0.04]"
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <p className="text-[13px] text-[#6e6e73]">
        {matchingProperties.length} bien{matchingProperties.length !== 1 ? "s" : ""} sélectionné
        {matchingProperties.length !== 1 ? "s" : ""}
      </p>

      {error && <p className="text-[13px] text-red-600">{error}</p>}

      {sortedRows && totals && !loading && !error && (
        <div className="space-y-2">
          {removedRowIds.size > 0 && (
            <p className="text-[13px] text-[#6e6e73]">
              {removedRowIds.size} bien{removedRowIds.size !== 1 ? "s" : ""} masqué{removedRowIds.size !== 1 ? "s" : ""} de cette liste ·{" "}
              <button type="button" onClick={() => setRemovedRowIds(new Set())} className="font-medium text-[#0071e3] hover:underline">
                Réafficher
              </button>
            </p>
          )}
          <div className="overflow-hidden rounded-[14px] border border-black/[0.06]">
            <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-black/[0.08] bg-black/[0.015]">
                  <SortHeader
                    label="Bien"
                    sortKey="reference"
                    activeKey={sortKey}
                    direction={direction}
                    onSort={handleSort}
                    align="left"
                  />
                  <SortHeader label="TR" sortKey="fillRate" activeKey={sortKey} direction={direction} onSort={handleSort} />
                  <SortHeader label="Rents" sortKey="rents" activeKey={sortKey} direction={direction} onSort={handleSort} />
                  <SortHeader
                    label="Channel Fees"
                    sortKey="channelFees"
                    activeKey={sortKey}
                    direction={direction}
                    onSort={handleSort}
                  />
                  <SortHeader
                    label="Net Revenue"
                    sortKey="netRevenue"
                    activeKey={sortKey}
                    direction={direction}
                    onSort={handleSort}
                  />
                  <SortHeader
                    label="Commission"
                    sortKey="commission"
                    activeKey={sortKey}
                    direction={direction}
                    onSort={handleSort}
                  />
                  <SortHeader
                    label="City Tax"
                    sortKey="cityTax"
                    activeKey={sortKey}
                    direction={direction}
                    onSort={handleSort}
                  />
                  <SortHeader
                    label="Transfer Fees"
                    sortKey="transferFees"
                    activeKey={sortKey}
                    direction={direction}
                    onSort={handleSort}
                  />
                  <SortHeader
                    label="Ménage"
                    sortKey="cleaningProfit"
                    activeKey={sortKey}
                    direction={direction}
                    onSort={handleSort}
                  />
                  <SortHeader
                    label="Loyer fixe"
                    sortKey="fixedRent"
                    activeKey={sortKey}
                    direction={direction}
                    onSort={handleSort}
                  />
                  <SortHeader label="Profit" sortKey="profit" activeKey={sortKey} direction={direction} onSort={handleSort} />
                </tr>
              </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr key={row.propertyId} className="border-b border-black/[0.05] transition-colors last:border-b-0 hover:bg-black/[0.015]">
                  <td className="py-2 pl-3 pr-2.5 text-[#1d1d1f]">
                    <button
                      type="button"
                      onClick={() => removeRow(row.propertyId)}
                      title="Retirer ce bien de la liste"
                      className="mr-1.5 text-[#c7c7cc] transition hover:text-red-600"
                    >
                      ✕
                    </button>
                    <span className="font-medium">{row.reference}</span>
                    {row.notFoundReferences.length > 0 && (
                      <span
                        title={`Référence VRPlatform introuvable : ${row.notFoundReferences.join(", ")}`}
                        className="ml-1.5 text-amber-600"
                      >
                        ⚠
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-2.5 text-right">
                    <span
                      className="inline-block rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums"
                      style={fillRateBadgeStyle(row.fillRate)}
                    >
                      {formatPercent(row.fillRate)}
                    </span>
                  </td>
                  <td className="py-2 px-2.5 text-right tabular-nums text-[#1d1d1f]">
                    <Money cents={row.rentsCents} />
                  </td>
                  <td className="py-2 px-2.5 text-right tabular-nums text-[#1d1d1f]">
                    <Money cents={row.channelFeesCents} />
                  </td>
                  <td className="py-2 px-2.5 text-right tabular-nums font-semibold text-[#1d1d1f]">
                    <Money cents={row.netRevenueCents} bold />
                  </td>
                  <td className="py-2 px-2.5 text-right tabular-nums text-[#1d1d1f]">
                    <Money cents={row.commissionCents} />
                  </td>
                  <td className="py-2 px-2.5 text-right tabular-nums text-[#1d1d1f]">
                    <Money cents={row.cityTaxCents} />
                  </td>
                  <td className="py-2 px-2.5 text-right tabular-nums text-[#1d1d1f]">
                    <Money cents={row.transferFeesCents} />
                  </td>
                  <td
                    className={`py-2 px-2.5 text-right tabular-nums font-semibold ${
                      row.cleaningProfitCents == null
                        ? "text-[#6e6e73]"
                        : row.cleaningProfitCents >= 0
                          ? "text-emerald-600"
                          : "text-red-600"
                    }`}
                  >
                    {row.cleaningProfitCents != null
                      ? `${row.cleaningProfitCents >= 0 ? "+" : ""}${formatEuros(row.cleaningProfitCents / 100)}`
                      : "—"}
                  </td>
                  <td className="py-2 px-2.5 text-right tabular-nums text-[#1d1d1f]">
                    <Money cents={row.fixedRentCents} />
                  </td>
                  <td
                    className={`py-2 pl-2.5 pr-3 text-right tabular-nums font-semibold ${
                      row.profitCents == null ? "text-[#6e6e73]" : row.profitCents >= 0 ? "text-emerald-600" : "text-red-600"
                    }`}
                  >
                    {row.profitCents != null ? `${row.profitCents >= 0 ? "+" : ""}${formatEuros(row.profitCents / 100)}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-black/[0.08] bg-black/[0.015] font-semibold text-[#1d1d1f]">
                <td className="py-2 pl-3 pr-2.5">
                  Total ({sortedRows.length} bien{sortedRows.length !== 1 ? "s" : ""})
                </td>
                <td className="py-2 px-2.5 text-right">
                  <span
                    className="inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums"
                    style={fillRateBadgeStyle(totals.fillRate)}
                  >
                    {formatPercent(totals.fillRate)}
                  </span>
                </td>
                <td className="py-2 px-2.5 text-right tabular-nums">
                  <Money cents={totals.rentsCents} bold />
                </td>
                <td className="py-2 px-2.5 text-right tabular-nums">
                  <Money cents={totals.channelFeesCents} bold />
                </td>
                <td className="py-2 px-2.5 text-right tabular-nums">
                  <Money cents={totals.netRevenueCents} bold />
                </td>
                <td className="py-2 px-2.5 text-right tabular-nums">
                  <Money cents={totals.commissionCents} bold />
                </td>
                <td className="py-2 px-2.5 text-right tabular-nums">
                  <Money cents={totals.cityTaxCents} bold />
                </td>
                <td className="py-2 px-2.5 text-right tabular-nums">
                  <Money cents={totals.transferFeesCents} bold />
                </td>
                <td
                  className={`py-2 px-2.5 text-right tabular-nums ${
                    totals.cleaningProfitCents >= 0 ? "text-emerald-600" : "text-red-600"
                  }`}
                >
                  {totals.cleaningProfitCents >= 0 ? "+" : ""}
                  {formatEuros(totals.cleaningProfitCents / 100)}
                </td>
                <td className="py-2 px-2.5 text-right tabular-nums">
                  <Money cents={totals.fixedRentCents} bold />
                </td>
                <td
                  className={`py-2 pl-2.5 pr-3 text-right tabular-nums ${
                    totals.profitCents >= 0 ? "text-emerald-600" : "text-red-600"
                  }`}
                >
                  {totals.profitCents >= 0 ? "+" : ""}
                  {formatEuros(totals.profitCents / 100)}
                </td>
              </tr>
            </tfoot>
            </table>
          </div>
        </div>
        </div>
      )}

      {!results && !loading && !error && (
        <p className="text-[13px] text-[#6e6e73]">
          Choisis une année, un ou plusieurs mois, filtre par bien/tag si besoin, puis charge les données.
        </p>
      )}
    </div>
  );
}
