"use client";

import { useMemo, useState } from "react";
import { fillRateBadgeStyle, formatPercent, MONTH_LABELS_SHORT } from "@/lib/format";
import type { PropertyOccupancyResult } from "@/lib/vrplatform";
import type { RentType } from "@/lib/types";

type SortKey = "reference" | "avgFillRate" | number;

const RENT_TYPE_LABELS: Record<RentType, string> = {
  fixe: "Fixe",
  variable: "Variable",
  fixe_variable: "Fixe + variable",
};

interface PropertyOption {
  id: string;
  reference: string;
  name: string | null;
  tags: string[];
  rentType: RentType | null;
}

function avgFillRate(property: PropertyOccupancyResult): number {
  if (property.months.length === 0) return 0;
  return property.months.reduce((sum, m) => sum + m.fillRate, 0) / property.months.length;
}

function monthFillRate(property: PropertyOccupancyResult, month: number): number {
  return property.months.find((m) => m.month === month)?.fillRate ?? 0;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function PropertyOccupancyTable({ properties: unsortedProperties }: { properties: PropertyOption[] }) {
  const now = new Date();
  const currentYear = now.getFullYear();
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
  const [selectedMonths, setSelectedMonths] = useState<number[]>([now.getMonth() + 1]);
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>(() => allProperties.map((p) => p.id));
  const [showProperties, setShowProperties] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedRentTypes, setSelectedRentTypes] = useState<RentType[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("reference");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [properties, setProperties] = useState<PropertyOccupancyResult[] | null>(null);
  const [removedPropertyIds, setRemovedPropertyIds] = useState<Set<string>>(new Set());
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
      const params = new URLSearchParams({
        year: String(year),
        months: selectedMonths.join(","),
        propertyIds: matchingProperties.map((p) => p.id).join(","),
      });
      const res = await fetch(`/api/finance/occupancy?${params.toString()}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setProperties(null);
      } else {
        setProperties(data.properties);
        setRemovedPropertyIds(new Set());
      }
    } catch {
      setError("Impossible de charger le taux de remplissage.");
    } finally {
      setLoading(false);
    }
  }

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDirection("asc");
    }
  }

  function removeProperty(propertyId: string) {
    setRemovedPropertyIds((prev) => new Set(prev).add(propertyId));
  }

  const sortedProperties = properties
    ? [...properties]
        .filter((p) => !removedPropertyIds.has(p.propertyId))
        .sort((a, b) => {
          let cmp: number;
          if (sortKey === "reference") cmp = a.reference.localeCompare(b.reference, "fr");
          else if (sortKey === "avgFillRate") cmp = avgFillRate(a) - avgFillRate(b);
          else cmp = monthFillRate(a, sortKey) - monthFillRate(b, sortKey);
          return direction === "asc" ? cmp : -cmp;
        })
    : null;

  const portfolioAverages = sortedProperties
    ? sortedProperties[0]?.months.map((m) => ({
        month: m.month,
        fillRate: average(sortedProperties.map((p) => monthFillRate(p, m.month))),
      }))
    : undefined;
  const portfolioOverallAverage = sortedProperties ? average(sortedProperties.map(avgFillRate)) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="field-label" htmlFor="occupancy-year">
            Année
          </label>
          <select
            id="occupancy-year"
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
          {loading ? "Chargement…" : properties ? "Actualiser" : "Charger"}
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

      {sortedProperties && !loading && !error && (
        <div className="space-y-2">
          {removedPropertyIds.size > 0 && (
            <p className="text-[13px] text-[#6e6e73]">
              {removedPropertyIds.size} bien{removedPropertyIds.size !== 1 ? "s" : ""} masqué
              {removedPropertyIds.size !== 1 ? "s" : ""} de cette liste ·{" "}
              <button
                type="button"
                onClick={() => setRemovedPropertyIds(new Set())}
                className="font-medium text-[#0071e3] hover:underline"
              >
                Réafficher
              </button>
            </p>
          )}
          <div className="overflow-hidden rounded-[14px] border border-black/[0.06]">
            <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[14px]">
              <thead>
                <tr className="border-b border-black/[0.08] bg-black/[0.015]">
                  <th className="py-3.5 pl-5 pr-4 text-left">
                    <button
                      type="button"
                      onClick={() => handleSort("reference")}
                      className={`inline-flex items-center gap-1 text-[13px] font-medium transition ${
                        sortKey === "reference" ? "text-[#1d1d1f]" : "text-[#86868b] hover:text-[#1d1d1f]"
                      }`}
                    >
                      Référence
                      {sortKey === "reference" && <span aria-hidden>{direction === "asc" ? "↑" : "↓"}</span>}
                    </button>
                  </th>
                  {sortedProperties[0]?.months.map((m) => (
                    <th key={m.month} className="py-3.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => handleSort(m.month)}
                        className={`inline-flex flex-row-reverse items-center gap-1 text-[13px] font-medium transition ${
                          sortKey === m.month ? "text-[#1d1d1f]" : "text-[#86868b] hover:text-[#1d1d1f]"
                        }`}
                      >
                        {MONTH_LABELS_SHORT[m.month - 1]}
                        {sortKey === m.month && <span aria-hidden>{direction === "asc" ? "↑" : "↓"}</span>}
                      </button>
                    </th>
                  ))}
                  {sortedProperties[0]?.months.length !== 1 && (
                    <th className="py-3.5 pl-4 pr-5 text-right">
                      <button
                        type="button"
                        onClick={() => handleSort("avgFillRate")}
                        className={`inline-flex flex-row-reverse items-center gap-1 text-[13px] font-medium transition ${
                          sortKey === "avgFillRate" ? "text-[#1d1d1f]" : "text-[#86868b] hover:text-[#1d1d1f]"
                        }`}
                      >
                        Moyenne
                        {sortKey === "avgFillRate" && <span aria-hidden>{direction === "asc" ? "↑" : "↓"}</span>}
                      </button>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {sortedProperties.map((property) => (
                  <tr
                    key={property.propertyId}
                    className="border-b border-black/[0.05] transition-colors last:border-b-0 hover:bg-black/[0.015]"
                  >
                    <td className="py-3.5 pl-5 pr-4 font-medium text-[#1d1d1f]">
                      <button
                        type="button"
                        onClick={() => removeProperty(property.propertyId)}
                        title="Retirer ce bien de la liste"
                        className="mr-1.5 font-normal text-[#c7c7cc] transition hover:text-red-600"
                      >
                        ✕
                      </button>
                      {property.reference}
                      {property.notFoundReferences.length > 0 && (
                        <span
                          title={`Référence VRPlatform introuvable : ${property.notFoundReferences.join(", ")}`}
                          className="ml-1.5 text-amber-600"
                        >
                          ⚠
                        </span>
                      )}
                    </td>
                    {property.months.map((m) => (
                      <td key={m.month} className="py-3.5 px-4 text-right">
                        <span
                          className="inline-block rounded-full px-2.5 py-0.5 text-[13px] font-medium tabular-nums"
                          style={fillRateBadgeStyle(m.fillRate)}
                        >
                          {formatPercent(m.fillRate)}
                        </span>
                      </td>
                    ))}
                    {property.months.length !== 1 && (
                      <td className="py-3.5 pl-4 pr-5 text-right">
                        <span
                          className="inline-block rounded-full px-2.5 py-0.5 text-[13px] font-semibold tabular-nums"
                          style={fillRateBadgeStyle(avgFillRate(property))}
                        >
                          {formatPercent(avgFillRate(property))}
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              {portfolioAverages && (
                <tfoot>
                  <tr className="border-t border-black/[0.08] bg-black/[0.015]">
                    <td className="py-3.5 pl-5 pr-4 font-semibold text-[#1d1d1f]">
                      Moyenne ({sortedProperties?.length ?? 0} bien{(sortedProperties?.length ?? 0) !== 1 ? "s" : ""})
                    </td>
                    {portfolioAverages.map((m) => (
                      <td key={m.month} className="py-3.5 px-4 text-right">
                        <span
                          className="inline-block rounded-full px-2.5 py-0.5 text-[13px] font-semibold tabular-nums"
                          style={fillRateBadgeStyle(m.fillRate)}
                        >
                          {formatPercent(m.fillRate)}
                        </span>
                      </td>
                    ))}
                    {portfolioAverages.length !== 1 && (
                      <td className="py-3.5 pl-4 pr-5 text-right">
                        <span
                          className="inline-block rounded-full px-2.5 py-0.5 text-[13px] font-semibold tabular-nums"
                          style={fillRateBadgeStyle(portfolioOverallAverage)}
                        >
                          {formatPercent(portfolioOverallAverage)}
                        </span>
                      </td>
                    )}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
        </div>
      )}

      {!properties && !loading && !error && (
        <p className="text-[13px] text-[#6e6e73]">
          Choisis une année, un ou plusieurs mois, filtre par référence/tag si besoin, puis charge les données.
        </p>
      )}
    </div>
  );
}
