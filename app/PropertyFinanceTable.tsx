"use client";

import { useMemo, useState } from "react";
import { formatEuros, MONTH_LABELS_SHORT } from "@/lib/format";
import type { PropertyMonthlyResult } from "@/lib/vrplatform";

type SortKey = "reference" | "rents" | "channelFees" | "netRevenue" | "commission" | "fixedRent" | "profit";

interface PropertyOption {
  id: string;
  reference: string;
  name: string | null;
  tags: string[];
}

interface FinanceRow {
  propertyId: string;
  reference: string;
  name: string | null;
  notFoundReferences: string[];
  isFixedRent: boolean;
  rentsCents: number;
  channelFeesCents: number;
  netRevenueCents: number;
  commissionCents: number | null;
  fixedRentCents: number | null;
  profitCents: number | null;
}

function toRow(property: PropertyMonthlyResult, selectedMonths: number[]): FinanceRow {
  const selected = property.months.filter((m) => selectedMonths.includes(m.month));
  const rentsCents = selected.reduce((sum, m) => sum + m.rentsCents, 0);
  const channelFeesCents = selected.reduce((sum, m) => sum + m.channelFeesCents, 0);
  const netRevenueCents = selected.reduce((sum, m) => sum + m.netRevenueCents, 0);
  const commissionCents =
    property.commissionPercent != null ? Math.round((netRevenueCents * property.commissionPercent) / 100) : null;
  const fixedRentCents =
    property.isFixedRent && property.fixedRentAmountCents != null
      ? property.fixedRentAmountCents * selectedMonths.length
      : null;
  const profitCents = property.isFixedRent ? (fixedRentCents != null ? netRevenueCents - fixedRentCents : null) : commissionCents;
  return {
    propertyId: property.propertyId,
    reference: property.reference,
    name: property.name,
    notFoundReferences: property.notFoundReferences,
    isFixedRent: property.isFixedRent,
    rentsCents,
    channelFeesCents,
    netRevenueCents,
    commissionCents,
    fixedRentCents,
    profitCents,
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
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  direction: "asc" | "desc";
  onSort: (key: SortKey) => void;
}) {
  const isActive = activeKey === sortKey;
  return (
    <th className="py-2 pr-3">
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 transition ${isActive ? "text-[#1d1d1f]" : "text-[#6e6e73] hover:text-[#1d1d1f]"}`}
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
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("reference");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [results, setResults] = useState<PropertyMonthlyResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matchingProperties = useMemo(() => {
    return allProperties.filter((p) => {
      const isSelected = selectedPropertyIds.includes(p.id);
      const matchesTags = selectedTags.length === 0 || p.tags.some((t) => selectedTags.includes(t));
      return isSelected && matchesTags;
    });
  }, [allProperties, selectedPropertyIds, selectedTags]);

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
      const params = new URLSearchParams({
        year: String(year),
        propertyIds: matchingProperties.map((p) => p.id).join(","),
      });
      const res = await fetch(`/api/finance/monthly?${params.toString()}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setResults(null);
      } else {
        setResults(data.properties);
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

  const rows = results?.map((r) => toRow(r, selectedMonths)) ?? null;

  const sortedRows = rows
    ? [...rows].sort((a, b) => {
        let cmp: number;
        switch (sortKey) {
          case "reference":
            cmp = a.reference.localeCompare(b.reference, "fr");
            break;
          case "rents":
            cmp = a.rentsCents - b.rentsCents;
            break;
          case "channelFees":
            cmp = a.channelFeesCents - b.channelFeesCents;
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
        }
        return direction === "asc" ? cmp : -cmp;
      })
    : null;

  const totals = sortedRows
    ? {
        rentsCents: sortedRows.reduce((sum, r) => sum + r.rentsCents, 0),
        channelFeesCents: sortedRows.reduce((sum, r) => sum + r.channelFeesCents, 0),
        netRevenueCents: sortedRows.reduce((sum, r) => sum + r.netRevenueCents, 0),
        commissionCents: sortedRows.reduce((sum, r) => sum + (r.commissionCents ?? 0), 0),
        fixedRentCents: sortedRows.reduce((sum, r) => sum + (r.fixedRentCents ?? 0), 0),
        profitCents: sortedRows.reduce((sum, r) => sum + (r.profitCents ?? 0), 0),
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
          <div className="flex gap-2">
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
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-black/10 text-left text-[12px] uppercase tracking-wide">
                <SortHeader label="Bien" sortKey="reference" activeKey={sortKey} direction={direction} onSort={handleSort} />
                <SortHeader label="Rents" sortKey="rents" activeKey={sortKey} direction={direction} onSort={handleSort} />
                <SortHeader
                  label="Channel Fees"
                  sortKey="channelFees"
                  activeKey={sortKey}
                  direction={direction}
                  onSort={handleSort}
                />
                <SortHeader
                  label="Net Commissionable Revenue"
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
                <tr key={row.propertyId} className="border-b border-black/5">
                  <td className="py-2 pr-3 text-[#1d1d1f]">
                    <span className="font-medium">{row.reference}</span>
                    {row.name && <span className="ml-1.5 text-[#6e6e73]">{row.name}</span>}
                    {row.notFoundReferences.length > 0 && (
                      <span
                        title={`Référence VRPlatform introuvable : ${row.notFoundReferences.join(", ")}`}
                        className="ml-1.5 text-amber-600"
                      >
                        ⚠
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-[#1d1d1f]">
                    <Money cents={row.rentsCents} />
                  </td>
                  <td className="py-2 pr-3 text-[#1d1d1f]">
                    <Money cents={row.channelFeesCents} />
                  </td>
                  <td className="py-2 pr-3 font-semibold text-[#1d1d1f]">
                    <Money cents={row.netRevenueCents} bold />
                  </td>
                  <td className="py-2 pr-3 text-[#1d1d1f]">
                    <Money cents={row.commissionCents} />
                  </td>
                  <td className="py-2 pr-3 text-[#1d1d1f]">
                    <Money cents={row.fixedRentCents} />
                  </td>
                  <td
                    className={`py-2 pr-3 font-semibold ${
                      row.profitCents == null ? "text-[#6e6e73]" : row.profitCents >= 0 ? "text-emerald-600" : "text-red-600"
                    }`}
                  >
                    {row.profitCents != null ? `${row.profitCents >= 0 ? "+" : ""}${formatEuros(row.profitCents / 100)}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-black/10 font-semibold text-[#1d1d1f]">
                <td className="py-2 pr-3">Total ({sortedRows.length} bien{sortedRows.length !== 1 ? "s" : ""})</td>
                <td className="py-2 pr-3">
                  <Money cents={totals.rentsCents} bold />
                </td>
                <td className="py-2 pr-3">
                  <Money cents={totals.channelFeesCents} bold />
                </td>
                <td className="py-2 pr-3">
                  <Money cents={totals.netRevenueCents} bold />
                </td>
                <td className="py-2 pr-3">
                  <Money cents={totals.commissionCents} bold />
                </td>
                <td className="py-2 pr-3">
                  <Money cents={totals.fixedRentCents} bold />
                </td>
                <td className={totals.profitCents >= 0 ? "py-2 pr-3 text-emerald-600" : "py-2 pr-3 text-red-600"}>
                  {totals.profitCents >= 0 ? "+" : ""}
                  {formatEuros(totals.profitCents / 100)}
                </td>
              </tr>
            </tfoot>
          </table>
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
