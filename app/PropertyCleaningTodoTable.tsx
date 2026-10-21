"use client";

import { useMemo, useState } from "react";
import { todayIso } from "@/lib/format";
import type { RentType } from "@/lib/types";

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
  cleaningProviderName: string | null;
}

interface CheckoutsApiResult {
  propertyId: string;
  reference: string;
  checkoutDates: string[];
  notFoundReferences: string[];
}

interface TodoRow {
  date: string;
  propertyId: string;
  reference: string;
  cleaningProviderName: string | null;
  notFoundReferences: string[];
}

function formatRowDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
}

function escapeCsvField(value: string): string {
  if (/[";\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function PropertyCleaningTodoTable({ properties: unsortedProperties }: { properties: PropertyOption[] }) {
  const allProperties = useMemo(
    () => [...unsortedProperties].sort((a, b) => a.reference.localeCompare(b.reference, "fr")),
    [unsortedProperties]
  );
  const allTags = useMemo(
    () => Array.from(new Set(allProperties.flatMap((p) => p.tags))).sort((a, b) => a.localeCompare(b, "fr")),
    [allProperties]
  );
  const allCleaningProviders = useMemo(
    () =>
      Array.from(new Set(allProperties.map((p) => p.cleaningProviderName).filter((n): n is string => n != null))).sort(
        (a, b) => a.localeCompare(b, "fr")
      ),
    [allProperties]
  );
  const propertyById = useMemo(() => new Map(allProperties.map((p) => [p.id, p])), [allProperties]);

  const today = todayIso();
  const [mode, setMode] = useState<"date" | "range">("date");
  const [date, setDate] = useState(today);
  const [rangeStart, setRangeStart] = useState(today);
  const [rangeEnd, setRangeEnd] = useState(today);
  const [showPeriodPicker, setShowPeriodPicker] = useState(false);
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>(() => allProperties.map((p) => p.id));
  const [showProperties, setShowProperties] = useState(false);
  const [tagFilters, setTagFilters] = useState<Record<string, "include" | "exclude">>({});
  const [selectedRentTypes, setSelectedRentTypes] = useState<RentType[]>([]);
  const [selectedCleaningProviders, setSelectedCleaningProviders] = useState<string[]>([]);
  const [results, setResults] = useState<CheckoutsApiResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const includedTags = useMemo(
    () => Object.entries(tagFilters).filter(([, m]) => m === "include").map(([tag]) => tag),
    [tagFilters]
  );
  const excludedTags = useMemo(
    () => Object.entries(tagFilters).filter(([, m]) => m === "exclude").map(([tag]) => tag),
    [tagFilters]
  );

  const matchingProperties = useMemo(() => {
    return allProperties.filter((p) => {
      const isSelected = selectedPropertyIds.includes(p.id);
      const matchesIncluded = includedTags.length === 0 || p.tags.some((t) => includedTags.includes(t));
      const matchesExcluded = excludedTags.length === 0 || !p.tags.some((t) => excludedTags.includes(t));
      const matchesRentType = selectedRentTypes.length === 0 || (p.rentType != null && selectedRentTypes.includes(p.rentType));
      const matchesCleaningProvider =
        selectedCleaningProviders.length === 0 ||
        (p.cleaningProviderName != null && selectedCleaningProviders.includes(p.cleaningProviderName));
      return isSelected && matchesIncluded && matchesExcluded && matchesRentType && matchesCleaningProvider;
    });
  }, [allProperties, selectedPropertyIds, includedTags, excludedTags, selectedRentTypes, selectedCleaningProviders]);

  function toggleProperty(id: string) {
    setSelectedPropertyIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  // Cycle à trois états par tag : neutre → inclure → exclure → neutre.
  function cycleTagFilter(tag: string) {
    setTagFilters((prev) => {
      const next = { ...prev };
      if (next[tag] === "include") next[tag] = "exclude";
      else if (next[tag] === "exclude") delete next[tag];
      else next[tag] = "include";
      return next;
    });
  }

  function toggleRentType(rentType: RentType) {
    setSelectedRentTypes((prev) => (prev.includes(rentType) ? prev.filter((t) => t !== rentType) : [...prev, rentType]));
  }

  function toggleCleaningProvider(name: string) {
    setSelectedCleaningProviders((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  }

  async function load() {
    if (matchingProperties.length === 0) {
      setError("Aucun bien ne correspond aux filtres.");
      return;
    }
    const startDate = mode === "date" ? date : rangeStart;
    const endDate = mode === "date" ? date : rangeEnd;
    if (startDate > endDate) {
      setError("La date de fin doit être après la date de début.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        startDate,
        endDate,
        propertyIds: matchingProperties.map((p) => p.id).join(","),
      });
      const res = await fetch(`/api/finance/checkouts-range?${params.toString()}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setResults(null);
      } else {
        setResults(data.properties);
      }
    } catch {
      setError("Impossible de charger les check-out.");
    } finally {
      setLoading(false);
    }
  }

  const rows: TodoRow[] | null = results
    ? results
        .flatMap((r) =>
          r.checkoutDates.map((checkoutDate) => ({
            date: checkoutDate,
            propertyId: r.propertyId,
            reference: r.reference,
            cleaningProviderName: propertyById.get(r.propertyId)?.cleaningProviderName ?? null,
            notFoundReferences: r.notFoundReferences,
          }))
        )
        .sort((a, b) => a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference, "fr"))
    : null;

  function exportCsv() {
    if (!rows || rows.length === 0) return;
    const rowsForCsv = [
      ["Date", "Bien", "Prestataire"],
      ...rows.map((r) => [r.date, r.reference, r.cleaningProviderName ?? ""]),
    ];
    const csvContent = rowsForCsv.map((r) => r.map(escapeCsvField).join(";")).join("\r\n");
    const blob = new Blob(["﻿" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `menages_a_faire_${mode === "date" ? date : `${rangeStart}_${rangeEnd}`}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const periodSummary =
    mode === "date"
      ? new Date(`${date}T00:00:00Z`).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
      : `${rangeStart} → ${rangeEnd}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <span className="field-label">Période</span>
          <button
            type="button"
            onClick={() => setShowPeriodPicker((v) => !v)}
            className="mt-1 flex h-9 items-center gap-2 rounded-[10px] border-2 border-[#0071e3] bg-white px-3 text-[13px] font-medium text-[#0071e3] transition hover:bg-[#0071e3]/5"
          >
            📅 {periodSummary}
            <span aria-hidden className={`transition-transform ${showPeriodPicker ? "rotate-180" : ""}`}>
              ▾
            </span>
          </button>
          {showPeriodPicker && (
            <div className="absolute left-0 top-full z-10 mt-1.5 w-max rounded-[12px] border border-black/10 bg-white p-3.5 shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
              <div className="flex gap-1 rounded-[8px] border border-black/10 bg-black/[0.03] p-0.5">
                <button
                  type="button"
                  onClick={() => setMode("date")}
                  className={`flex-1 rounded-[6px] px-2.5 py-1 text-[12px] font-medium transition ${
                    mode === "date" ? "bg-white text-[#1d1d1f] shadow-sm" : "text-[#6e6e73] hover:text-[#1d1d1f]"
                  }`}
                >
                  Une date
                </button>
                <button
                  type="button"
                  onClick={() => setMode("range")}
                  className={`flex-1 rounded-[6px] px-2.5 py-1 text-[12px] font-medium transition ${
                    mode === "range" ? "bg-white text-[#1d1d1f] shadow-sm" : "text-[#6e6e73] hover:text-[#1d1d1f]"
                  }`}
                >
                  Période
                </button>
              </div>

              {mode === "date" ? (
                <div className="mt-3">
                  <label className="field-label" htmlFor="todo-date">
                    Date
                  </label>
                  <input
                    id="todo-date"
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="mt-1 rounded-[10px] border border-black/10 bg-white px-3 py-2 text-[14px] text-[#1d1d1f] shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus:border-[#0071e3] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
                  />
                </div>
              ) : (
                <div className="mt-3 flex items-end gap-2">
                  <div>
                    <label className="field-label" htmlFor="todo-range-start">
                      Du
                    </label>
                    <input
                      id="todo-range-start"
                      type="date"
                      value={rangeStart}
                      onChange={(e) => setRangeStart(e.target.value)}
                      className="mt-1 rounded-[10px] border border-black/10 bg-white px-3 py-2 text-[14px] text-[#1d1d1f] shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus:border-[#0071e3] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="todo-range-end">
                      Au
                    </label>
                    <input
                      id="todo-range-end"
                      type="date"
                      value={rangeEnd}
                      onChange={(e) => setRangeEnd(e.target.value)}
                      className="mt-1 rounded-[10px] border border-black/10 bg-white px-3 py-2 text-[14px] text-[#1d1d1f] shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus:border-[#0071e3] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
                    />
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => setShowPeriodPicker(false)}
                className="mt-3 w-full rounded-[8px] bg-[#0071e3] px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-[#0071e3]/90"
              >
                Valider
              </button>
            </div>
          )}
        </div>

        <div>
          <span className="field-label invisible">Charger</span>
          <button type="button" onClick={load} disabled={loading} className="btn-secondary btn-sm mt-1 h-9">
            {loading ? "Chargement…" : results ? "Actualiser" : "Charger"}
          </button>
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowProperties((v) => !v)}
            className="flex items-center gap-2 rounded-[10px] border-2 border-[#0071e3] bg-white px-3 py-2 text-[13px] font-medium text-[#0071e3] transition hover:bg-[#0071e3]/5"
          >
            🏠 Choisir les biens ({selectedPropertyIds.length}/{allProperties.length})
            <span aria-hidden className={`transition-transform ${showProperties ? "rotate-180" : ""}`}>
              ▾
            </span>
          </button>
          <span className="rounded-full bg-[#0071e3]/10 px-3 py-1.5 text-[13px] font-semibold text-[#0071e3]">
            {matchingProperties.length} bien{matchingProperties.length !== 1 ? "s" : ""} sélectionné
            {matchingProperties.length !== 1 ? "s" : ""} (après filtres)
          </span>
        </div>
        {showProperties && (
          <>
            <div className="mt-2 flex justify-end gap-2">
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
          <p className="mt-0.5 text-[11px] text-[#86868b]">Clic : inclure · reclic : exclure · reclic : neutre</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {allTags.map((tag) => {
              const tagMode = tagFilters[tag];
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => cycleTagFilter(tag)}
                  title={
                    tagMode === "include"
                      ? "Inclus — clic pour exclure"
                      : tagMode === "exclude"
                        ? "Exclu — clic pour désactiver"
                        : "Clic pour inclure"
                  }
                  className={`rounded-full border px-2.5 py-1 text-[13px] font-medium transition ${
                    tagMode === "include"
                      ? "border-[#0071e3] bg-[#0071e3] text-white"
                      : tagMode === "exclude"
                        ? "border-[#ff3b30] bg-[#ff3b30] text-white"
                        : "border-black/10 bg-white text-[#1d1d1f] hover:bg-black/[0.04]"
                  }`}
                >
                  {tagMode === "exclude" ? "− " : tagMode === "include" ? "+ " : ""}
                  {tag}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {allCleaningProviders.length > 0 && (
        <div>
          <span className="field-label">Prestataire de ménage</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {allCleaningProviders.map((name) => {
              const active = selectedCleaningProviders.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => toggleCleaningProvider(name)}
                  className={`rounded-full border px-2.5 py-1 text-[13px] font-medium transition ${
                    active
                      ? "border-[#0071e3] bg-[#0071e3] text-white"
                      : "border-black/10 bg-white text-[#1d1d1f] hover:bg-black/[0.04]"
                  }`}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {error && <p className="text-[13px] text-red-600">{error}</p>}

      {rows && rows.length === 0 && !loading && !error && (
        <p className="text-[13px] text-[#6e6e73]">Aucun check-out sur cette période.</p>
      )}

      {rows && rows.length > 0 && !loading && !error && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="rounded-full bg-[#0071e3]/10 px-3 py-1.5 text-[13px] font-semibold text-[#0071e3]">
              {rows.length} ménage{rows.length !== 1 ? "s" : ""} à faire
            </span>
            <button type="button" onClick={exportCsv} className="btn-secondary btn-sm">
              Exporter (CSV)
            </button>
          </div>
          <div className="overflow-hidden rounded-[14px] border border-black/[0.06]">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-black/[0.08] bg-black/[0.015]">
                    <th className="py-1.5 pl-3 pr-2 text-left text-[11px] font-medium text-[#86868b]">Date</th>
                    <th className="py-1.5 px-2 text-left text-[11px] font-medium text-[#86868b]">Bien</th>
                    <th className="py-1.5 px-2 text-left text-[11px] font-medium text-[#86868b]">Prestataire</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rowIndex) => (
                    <tr
                      key={`${row.propertyId}-${row.date}`}
                      className={`border-b border-black/[0.04] transition-colors last:border-b-0 hover:bg-[#dceafb] ${
                        rowIndex % 2 === 0 ? "bg-white" : "bg-[#f0f6fd]"
                      }`}
                    >
                      <td className="py-1.5 pl-3 pr-2 text-[#1d1d1f]">{formatRowDate(row.date)}</td>
                      <td className="py-1.5 px-2 font-medium text-[#1d1d1f]">
                        {row.reference}
                        {row.notFoundReferences.length > 0 && (
                          <span
                            title={`Référence VRPlatform introuvable : ${row.notFoundReferences.join(", ")}`}
                            className="ml-1.5 text-amber-600"
                          >
                            ⚠
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 px-2 text-[#6e6e73]">{row.cleaningProviderName ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {!results && !loading && !error && (
        <p className="text-[13px] text-[#6e6e73]">Choisis une date ou une période, filtre par bien/tag si besoin, puis charge les données.</p>
      )}
    </div>
  );
}
