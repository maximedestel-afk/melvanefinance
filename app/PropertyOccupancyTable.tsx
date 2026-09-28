"use client";

import { useMemo, useState } from "react";
import { fillRateBadgeStyle, formatPercent, MONTH_LABELS_SHORT } from "@/lib/format";
import type { PropertyOccupancyResult } from "@/lib/vrplatform";
import type { RentType } from "@/lib/types";

type SortKey = "reference" | "avgFillRate" | "bookingWindow" | number;

interface BookingWindowResult {
  propertyId: string;
  sampleSize: number;
  medianLeadTimeDays: number | null;
}

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

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
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
  const [showPeriodPicker, setShowPeriodPicker] = useState(false);
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>(() => allProperties.map((p) => p.id));
  const [showProperties, setShowProperties] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedRentTypes, setSelectedRentTypes] = useState<RentType[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("reference");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [properties, setProperties] = useState<PropertyOccupancyResult[] | null>(null);
  const [bookingWindows, setBookingWindows] = useState<BookingWindowResult[] | null>(null);
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
      const propertyIds = matchingProperties.map((p) => p.id).join(",");
      const params = new URLSearchParams({ year: String(year), months: selectedMonths.join(","), propertyIds });
      const bookingWindowParams = new URLSearchParams({ propertyIds });
      const [res, bookingWindowRes] = await Promise.all([
        fetch(`/api/finance/occupancy?${params.toString()}`),
        fetch(`/api/finance/booking-window-portfolio?${bookingWindowParams.toString()}`),
      ]);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setProperties(null);
      } else {
        setProperties(data.properties);
        setRemovedPropertyIds(new Set());
      }
      // La fenêtre de réservation est une donnée de contexte : une erreur ici
      // (VRPlatform indisponible, etc.) n'empêche pas d'afficher le reste du
      // tableau.
      const bookingWindowData = await bookingWindowRes.json();
      setBookingWindows(bookingWindowData.error ? null : bookingWindowData.properties);
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

  const bookingWindowByPropertyId = new Map((bookingWindows ?? []).map((b) => [b.propertyId, b]));

  const sortedProperties = properties
    ? [...properties]
        .filter((p) => !removedPropertyIds.has(p.propertyId))
        .sort((a, b) => {
          let cmp: number;
          if (sortKey === "reference") cmp = a.reference.localeCompare(b.reference, "fr");
          else if (sortKey === "avgFillRate") cmp = avgFillRate(a) - avgFillRate(b);
          else if (sortKey === "bookingWindow") {
            cmp =
              (bookingWindowByPropertyId.get(a.propertyId)?.medianLeadTimeDays ?? 0) -
              (bookingWindowByPropertyId.get(b.propertyId)?.medianLeadTimeDays ?? 0);
          } else cmp = monthFillRate(a, sortKey) - monthFillRate(b, sortKey);
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
  const portfolioMedianBookingWindow = sortedProperties
    ? median(
        sortedProperties
          .map((p) => bookingWindowByPropertyId.get(p.propertyId)?.medianLeadTimeDays)
          .filter((v): v is number => v != null)
      )
    : null;

  const periodSummary =
    selectedMonths.length === 0
      ? "Aucun mois"
      : selectedMonths.length === 12
        ? `Année complète ${year}`
        : `${selectedMonths.map((m) => MONTH_LABELS_SHORT[m - 1]).join(", ")} ${year}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowPeriodPicker((v) => !v)}
            className="flex items-center gap-2 rounded-[10px] border-2 border-[#0071e3] bg-white px-3 py-2 text-[13px] font-medium text-[#0071e3] transition hover:bg-[#0071e3]/5"
          >
            📅 {periodSummary}
            <span aria-hidden className={`transition-transform ${showPeriodPicker ? "rotate-180" : ""}`}>
              ▾
            </span>
          </button>
          {showPeriodPicker && (
            <div className="absolute left-0 top-full z-10 mt-1.5 w-max rounded-[12px] border border-black/10 bg-white p-3.5 shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
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

              <div className="mt-3">
                <span className="field-label">Mois</span>
                <div className="mt-1 flex flex-wrap gap-1 max-w-[280px]">
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

        <button type="button" onClick={load} disabled={loading} className="btn-secondary btn-sm">
          {loading ? "Chargement…" : properties ? "Actualiser" : "Charger"}
        </button>
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
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-black/[0.08] bg-black/[0.015]">
                  <th className="py-1.5 pl-3 pr-2 text-left">
                    <button
                      type="button"
                      onClick={() => handleSort("reference")}
                      className={`inline-flex items-center gap-1 text-[11px] font-medium transition ${
                        sortKey === "reference" ? "text-[#1d1d1f]" : "text-[#86868b] hover:text-[#1d1d1f]"
                      }`}
                    >
                      Référence
                      {sortKey === "reference" && <span aria-hidden>{direction === "asc" ? "↑" : "↓"}</span>}
                    </button>
                  </th>
                  {sortedProperties[0]?.months.map((m) => (
                    <th key={m.month} className="py-1.5 px-2 text-right">
                      <button
                        type="button"
                        onClick={() => handleSort(m.month)}
                        className={`inline-flex flex-row-reverse items-center gap-1 text-[11px] font-medium transition ${
                          sortKey === m.month ? "text-[#1d1d1f]" : "text-[#86868b] hover:text-[#1d1d1f]"
                        }`}
                      >
                        {MONTH_LABELS_SHORT[m.month - 1]}
                        {sortKey === m.month && <span aria-hidden>{direction === "asc" ? "↑" : "↓"}</span>}
                      </button>
                    </th>
                  ))}
                  {sortedProperties[0]?.months.length !== 1 && (
                    <th className="py-1.5 px-2 text-right">
                      <button
                        type="button"
                        onClick={() => handleSort("avgFillRate")}
                        className={`inline-flex flex-row-reverse items-center gap-1 text-[11px] font-medium transition ${
                          sortKey === "avgFillRate" ? "text-[#1d1d1f]" : "text-[#86868b] hover:text-[#1d1d1f]"
                        }`}
                      >
                        Moyenne
                        {sortKey === "avgFillRate" && <span aria-hidden>{direction === "asc" ? "↑" : "↓"}</span>}
                      </button>
                    </th>
                  )}
                  <th className="py-1.5 pl-2 pr-3 text-right" title="Médiane du nombre de jours entre la réservation et le check-in, sur les réservations faites au cours des 12 derniers mois">
                    <button
                      type="button"
                      onClick={() => handleSort("bookingWindow")}
                      className={`inline-flex w-24 flex-row-reverse items-center gap-1 whitespace-normal text-left text-[11px] font-medium leading-tight transition ${
                        sortKey === "bookingWindow" ? "text-[#1d1d1f]" : "text-[#86868b] hover:text-[#1d1d1f]"
                      }`}
                    >
                      Fenêtre de résa (12 mois)
                      {sortKey === "bookingWindow" && <span aria-hidden>{direction === "asc" ? "↑" : "↓"}</span>}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedProperties.map((property, rowIndex) => (
                  <tr
                    key={property.propertyId}
                    className={`border-b border-black/[0.04] transition-colors last:border-b-0 hover:bg-[#dceafb] ${
                      rowIndex % 2 === 0 ? "bg-white" : "bg-[#f0f6fd]"
                    }`}
                  >
                    <td className="py-1.5 pl-3 pr-2 font-medium text-[#1d1d1f]">
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
                      <td key={m.month} className="py-1.5 px-2 text-right">
                        <span
                          className="inline-block rounded-full px-2.5 py-0.5 text-[11px] font-medium tabular-nums"
                          style={fillRateBadgeStyle(m.fillRate)}
                        >
                          {formatPercent(m.fillRate)}
                        </span>
                      </td>
                    ))}
                    {property.months.length !== 1 && (
                      <td className="py-1.5 px-2 text-right">
                        <span
                          className="inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold tabular-nums"
                          style={fillRateBadgeStyle(avgFillRate(property))}
                        >
                          {formatPercent(avgFillRate(property))}
                        </span>
                      </td>
                    )}
                    <td className="py-1.5 pl-2 pr-3 text-right tabular-nums text-[#1d1d1f]">
                      {(() => {
                        const bw = bookingWindowByPropertyId.get(property.propertyId);
                        return bw?.medianLeadTimeDays != null ? `${Math.round(bw.medianLeadTimeDays)} j` : "—";
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
              {portfolioAverages && (
                <tfoot>
                  <tr className="border-t border-black/[0.08] bg-black/[0.015]">
                    <td className="py-1.5 pl-3 pr-2 font-semibold text-[#1d1d1f]">
                      Moyenne ({sortedProperties?.length ?? 0} bien{(sortedProperties?.length ?? 0) !== 1 ? "s" : ""})
                    </td>
                    {portfolioAverages.map((m) => (
                      <td key={m.month} className="py-1.5 px-2 text-right">
                        <span
                          className="inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold tabular-nums"
                          style={fillRateBadgeStyle(m.fillRate)}
                        >
                          {formatPercent(m.fillRate)}
                        </span>
                      </td>
                    ))}
                    {portfolioAverages.length !== 1 && (
                      <td className="py-1.5 px-2 text-right">
                        <span
                          className="inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold tabular-nums"
                          style={fillRateBadgeStyle(portfolioOverallAverage)}
                        >
                          {formatPercent(portfolioOverallAverage)}
                        </span>
                      </td>
                    )}
                    <td className="py-1.5 pl-2 pr-3 text-right tabular-nums text-[#1d1d1f]">
                      {portfolioMedianBookingWindow != null ? `${Math.round(portfolioMedianBookingWindow)} j` : "—"}
                    </td>
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
