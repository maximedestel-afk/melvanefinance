"use client";

import { useMemo, useState } from "react";
import { formatEuros, MONTH_LABELS_SHORT } from "@/lib/format";
import type { RentType } from "@/lib/types";

type SortKey = "reference" | "count" | "customField" | "guesty" | "productCustom" | "productGuesty" | "diff";
type ColumnKey = "reference" | "count" | "dates" | "customField" | "guesty" | "productCustom" | "productGuesty" | "diff";

const RENT_TYPE_LABELS: Record<RentType, string> = {
  fixe: "Fixe",
  variable: "Variable",
  fixe_variable: "Fixe + variable",
};

const ALL_COLUMNS: ColumnKey[] = [
  "reference",
  "count",
  "dates",
  "customField",
  "guesty",
  "productCustom",
  "productGuesty",
  "diff",
];

const COLUMN_LABELS: Record<ColumnKey, string> = {
  reference: "Bien",
  count: "Check-out",
  dates: "Dates",
  customField: "Prix ménage (custom field)",
  guesty: "Prix ménage (Guesty)",
  productCustom: "Produit (custom field)",
  productGuesty: "Produit (Guesty)",
  diff: "Différence",
};

interface PropertyOption {
  id: string;
  reference: string;
  tags: string[];
  rentType: RentType | null;
}

interface CleaningApiResult {
  propertyId: string;
  reference: string;
  checkoutDates: string[];
  notFoundReferences: string[];
  cleaningFeeCustomField: number | null;
  cleaningFeeGuesty: number | null;
  guestyError: string | null;
}

interface CleaningRow {
  propertyId: string;
  reference: string;
  notFoundReferences: string[];
  guestyError: string | null;
  checkoutDates: string[];
  checkoutCount: number;
  cleaningFeeCustomField: number | null;
  cleaningFeeGuesty: number | null;
  productCustom: number | null;
  productGuesty: number | null;
  diff: number | null;
}

function toRow(r: CleaningApiResult): CleaningRow {
  const checkoutCount = r.checkoutDates.length;
  const productCustom = r.cleaningFeeCustomField != null ? checkoutCount * r.cleaningFeeCustomField : null;
  const productGuesty = r.cleaningFeeGuesty != null ? checkoutCount * r.cleaningFeeGuesty : null;
  const diff = productGuesty != null && productCustom != null ? productGuesty - productCustom : null;
  return {
    propertyId: r.propertyId,
    reference: r.reference,
    notFoundReferences: r.notFoundReferences,
    guestyError: r.guestyError,
    checkoutDates: r.checkoutDates,
    checkoutCount,
    cleaningFeeCustomField: r.cleaningFeeCustomField,
    cleaningFeeGuesty: r.cleaningFeeGuesty,
    productCustom,
    productGuesty,
    diff,
  };
}

function formatShortDate(isoDate: string): string {
  const [, monthStr, dayStr] = isoDate.split("-");
  return `${dayStr} ${MONTH_LABELS_SHORT[Number(monthStr) - 1]}`;
}

function rowCellValue(row: CleaningRow, col: ColumnKey): string {
  switch (col) {
    case "reference":
      return row.reference;
    case "count":
      return String(row.checkoutCount);
    case "dates":
      return row.checkoutDates.length > 0 ? row.checkoutDates.map(formatShortDate).join(", ") : "";
    case "customField":
      return row.cleaningFeeCustomField != null ? formatEuros(row.cleaningFeeCustomField) : "";
    case "guesty":
      return row.cleaningFeeGuesty != null ? formatEuros(row.cleaningFeeGuesty) : "";
    case "productCustom":
      return row.productCustom != null ? formatEuros(row.productCustom) : "";
    case "productGuesty":
      return row.productGuesty != null ? formatEuros(row.productGuesty) : "";
    case "diff":
      return row.diff != null ? formatEuros(row.diff) : "";
  }
}

function escapeCsvField(value: string): string {
  if (/[";\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function EuroValue({ value, bold = false }: { value: number | null; bold?: boolean }) {
  if (value == null) return <span className="text-[#6e6e73]">—</span>;
  return <span className={bold ? "font-semibold" : undefined}>{formatEuros(value)}</span>;
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
    <th className={`py-3.5 px-4 first:pl-5 last:pr-5 ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 text-[13px] font-medium transition ${
          align === "right" ? "flex-row-reverse" : ""
        } ${isActive ? "text-[#1d1d1f]" : "text-[#86868b] hover:text-[#1d1d1f]"}`}
      >
        {label}
        {isActive && <span aria-hidden>{direction === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}

export function PropertyCleaningTable({ properties: unsortedProperties }: { properties: PropertyOption[] }) {
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
  const [selectedRentTypes, setSelectedRentTypes] = useState<RentType[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("reference");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [hiddenColumns, setHiddenColumns] = useState<Set<ColumnKey>>(new Set());
  const [removedRowIds, setRemovedRowIds] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<CleaningApiResult[] | null>(null);
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

  function toggleColumn(col: ColumnKey) {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col);
      else next.add(col);
      return next;
    });
  }

  function removeRow(propertyId: string) {
    setRemovedRowIds((prev) => new Set(prev).add(propertyId));
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
        months: selectedMonths.join(","),
        propertyIds: matchingProperties.map((p) => p.id).join(","),
      });
      const res = await fetch(`/api/finance/cleaning?${params.toString()}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setResults(null);
      } else {
        setResults(data.properties);
        setRemovedRowIds(new Set());
      }
    } catch {
      setError("Impossible de charger les données de ménage.");
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

  const rows = results?.map(toRow).filter((r) => r.checkoutCount > 0 && !removedRowIds.has(r.propertyId)) ?? null;

  const sortedRows = rows
    ? [...rows].sort((a, b) => {
        let cmp: number;
        switch (sortKey) {
          case "reference":
            cmp = a.reference.localeCompare(b.reference, "fr");
            break;
          case "count":
            cmp = a.checkoutCount - b.checkoutCount;
            break;
          case "customField":
            cmp = (a.cleaningFeeCustomField ?? 0) - (b.cleaningFeeCustomField ?? 0);
            break;
          case "guesty":
            cmp = (a.cleaningFeeGuesty ?? 0) - (b.cleaningFeeGuesty ?? 0);
            break;
          case "productCustom":
            cmp = (a.productCustom ?? 0) - (b.productCustom ?? 0);
            break;
          case "productGuesty":
            cmp = (a.productGuesty ?? 0) - (b.productGuesty ?? 0);
            break;
          case "diff":
            cmp = (a.diff ?? 0) - (b.diff ?? 0);
            break;
        }
        return direction === "asc" ? cmp : -cmp;
      })
    : null;

  const totals = sortedRows
    ? {
        checkoutCount: sortedRows.reduce((sum, r) => sum + r.checkoutCount, 0),
        productCustom: sortedRows.reduce((sum, r) => sum + (r.productCustom ?? 0), 0),
        productGuesty: sortedRows.reduce((sum, r) => sum + (r.productGuesty ?? 0), 0),
      }
    : null;

  const visibleColumns = ALL_COLUMNS.filter((c) => !hiddenColumns.has(c));

  function exportCsv() {
    if (!sortedRows || sortedRows.length === 0) return;
    const totalCellValue = (col: ColumnKey): string => {
      if (!totals) return "";
      switch (col) {
        case "reference":
          return `Total (${sortedRows.length} biens)`;
        case "count":
          return String(totals.checkoutCount);
        case "productCustom":
          return formatEuros(totals.productCustom);
        case "productGuesty":
          return formatEuros(totals.productGuesty);
        case "diff":
          return formatEuros(totals.productGuesty - totals.productCustom);
        default:
          return "";
      }
    };

    const rowsForCsv = [
      visibleColumns.map((c) => COLUMN_LABELS[c]),
      ...sortedRows.map((row) => visibleColumns.map((c) => rowCellValue(row, c))),
      visibleColumns.map((c) => totalCellValue(c)),
    ];
    const csvContent = rowsForCsv.map((r) => r.map(escapeCsvField).join(";")).join("\r\n");
    const blob = new Blob(["﻿" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `menage_${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="field-label" htmlFor="cleaning-year">
            Année
          </label>
          <select
            id="cleaning-year"
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

      <div>
        <span className="field-label">Colonnes</span>
        <div className="mt-1 flex flex-wrap gap-1">
          {ALL_COLUMNS.map((col) => {
            const visible = !hiddenColumns.has(col);
            return (
              <button
                key={col}
                type="button"
                onClick={() => toggleColumn(col)}
                className={`rounded-full border px-2.5 py-1 text-[13px] font-medium transition ${
                  visible
                    ? "border-[#0071e3] bg-[#0071e3] text-white"
                    : "border-black/10 bg-white text-[#86868b] hover:bg-black/[0.04]"
                }`}
              >
                {COLUMN_LABELS[col]}
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-[13px] text-[#6e6e73]">
        {matchingProperties.length} bien{matchingProperties.length !== 1 ? "s" : ""} sélectionné
        {matchingProperties.length !== 1 ? "s" : ""}
      </p>

      {error && <p className="text-[13px] text-red-600">{error}</p>}

      {sortedRows && sortedRows.length === 0 && !loading && !error && (
        <p className="text-[13px] text-[#6e6e73]">Aucun bien n&apos;a eu de check-out sur cette période.</p>
      )}

      {sortedRows && sortedRows.length > 0 && totals && !loading && !error && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            {removedRowIds.size > 0 ? (
              <p className="text-[13px] text-[#6e6e73]">
                {removedRowIds.size} bien{removedRowIds.size !== 1 ? "s" : ""} masqué{removedRowIds.size !== 1 ? "s" : ""} de cette liste ·{" "}
                <button type="button" onClick={() => setRemovedRowIds(new Set())} className="font-medium text-[#0071e3] hover:underline">
                  Réafficher
                </button>
              </p>
            ) : (
              <span />
            )}
            <button type="button" onClick={exportCsv} className="btn-secondary btn-sm">
              Exporter (CSV)
            </button>
          </div>
          <div className="overflow-hidden rounded-[14px] border border-black/[0.06]">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[14px]">
                <thead>
                  <tr className="border-b border-black/[0.08] bg-black/[0.015]">
                    {!hiddenColumns.has("reference") && (
                      <SortHeader
                        label="Bien"
                        sortKey="reference"
                        activeKey={sortKey}
                        direction={direction}
                        onSort={handleSort}
                        align="left"
                      />
                    )}
                    {!hiddenColumns.has("count") && (
                      <SortHeader label="Check-out" sortKey="count" activeKey={sortKey} direction={direction} onSort={handleSort} />
                    )}
                    {!hiddenColumns.has("dates") && (
                      <th className="py-3.5 px-4 text-left text-[13px] font-medium text-[#86868b]">Dates</th>
                    )}
                    {!hiddenColumns.has("customField") && (
                      <SortHeader
                        label="Prix ménage (custom field)"
                        sortKey="customField"
                        activeKey={sortKey}
                        direction={direction}
                        onSort={handleSort}
                      />
                    )}
                    {!hiddenColumns.has("guesty") && (
                      <SortHeader
                        label="Prix ménage (Guesty)"
                        sortKey="guesty"
                        activeKey={sortKey}
                        direction={direction}
                        onSort={handleSort}
                      />
                    )}
                    {!hiddenColumns.has("productCustom") && (
                      <SortHeader
                        label="Produit (custom field)"
                        sortKey="productCustom"
                        activeKey={sortKey}
                        direction={direction}
                        onSort={handleSort}
                      />
                    )}
                    {!hiddenColumns.has("productGuesty") && (
                      <SortHeader
                        label="Produit (Guesty)"
                        sortKey="productGuesty"
                        activeKey={sortKey}
                        direction={direction}
                        onSort={handleSort}
                      />
                    )}
                    {!hiddenColumns.has("diff") && (
                      <SortHeader label="Différence" sortKey="diff" activeKey={sortKey} direction={direction} onSort={handleSort} />
                    )}
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row) => (
                    <tr
                      key={row.propertyId}
                      className="border-b border-black/[0.05] transition-colors last:border-b-0 hover:bg-black/[0.015]"
                    >
                      {!hiddenColumns.has("reference") && (
                        <td className="py-3.5 pl-5 pr-4 text-[#1d1d1f]">
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
                          {row.guestyError && (
                            <span title={`Guesty : ${row.guestyError}`} className="ml-1.5 text-red-600">
                              ⚠
                            </span>
                          )}
                        </td>
                      )}
                      {!hiddenColumns.has("count") && (
                        <td className="py-3.5 px-4 text-right tabular-nums font-semibold text-[#1d1d1f]">{row.checkoutCount}</td>
                      )}
                      {!hiddenColumns.has("dates") && (
                        <td className="py-3.5 px-4 text-[#6e6e73]">
                          {row.checkoutDates.length > 0 ? row.checkoutDates.map(formatShortDate).join(", ") : "—"}
                        </td>
                      )}
                      {!hiddenColumns.has("customField") && (
                        <td className="py-3.5 px-4 text-right tabular-nums text-[#1d1d1f]">
                          <EuroValue value={row.cleaningFeeCustomField} />
                        </td>
                      )}
                      {!hiddenColumns.has("guesty") && (
                        <td className="py-3.5 px-4 text-right tabular-nums text-[#1d1d1f]">
                          <EuroValue value={row.cleaningFeeGuesty} />
                        </td>
                      )}
                      {!hiddenColumns.has("productCustom") && (
                        <td className="py-3.5 px-4 text-right tabular-nums text-[#1d1d1f]">
                          <EuroValue value={row.productCustom} />
                        </td>
                      )}
                      {!hiddenColumns.has("productGuesty") && (
                        <td className="py-3.5 px-4 text-right tabular-nums font-semibold text-[#1d1d1f]">
                          <EuroValue value={row.productGuesty} bold />
                        </td>
                      )}
                      {!hiddenColumns.has("diff") && (
                        <td
                          className={`py-3.5 pl-4 pr-5 text-right tabular-nums font-semibold ${
                            row.diff == null ? "text-[#6e6e73]" : row.diff >= 0 ? "text-emerald-600" : "text-red-600"
                          }`}
                        >
                          {row.diff != null ? `${row.diff >= 0 ? "+" : ""}${formatEuros(row.diff)}` : "—"}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-black/[0.08] bg-black/[0.015] font-semibold text-[#1d1d1f]">
                    {!hiddenColumns.has("reference") && (
                      <td className="py-3.5 pl-5 pr-4">
                        Total ({sortedRows.length} bien{sortedRows.length !== 1 ? "s" : ""})
                      </td>
                    )}
                    {!hiddenColumns.has("count") && (
                      <td className="py-3.5 px-4 text-right tabular-nums">{totals.checkoutCount}</td>
                    )}
                    {!hiddenColumns.has("dates") && <td className="py-3.5 px-4"></td>}
                    {!hiddenColumns.has("customField") && <td className="py-3.5 px-4"></td>}
                    {!hiddenColumns.has("guesty") && <td className="py-3.5 px-4"></td>}
                    {!hiddenColumns.has("productCustom") && (
                      <td className="py-3.5 px-4 text-right tabular-nums">
                        <EuroValue value={totals.productCustom} bold />
                      </td>
                    )}
                    {!hiddenColumns.has("productGuesty") && (
                      <td className="py-3.5 px-4 text-right tabular-nums">
                        <EuroValue value={totals.productGuesty} bold />
                      </td>
                    )}
                    {!hiddenColumns.has("diff") && (
                      <td
                        className={`py-3.5 pl-4 pr-5 text-right tabular-nums ${
                          totals.productGuesty - totals.productCustom >= 0 ? "text-emerald-600" : "text-red-600"
                        }`}
                      >
                        {totals.productGuesty - totals.productCustom >= 0 ? "+" : ""}
                        {formatEuros(totals.productGuesty - totals.productCustom)}
                      </td>
                    )}
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
