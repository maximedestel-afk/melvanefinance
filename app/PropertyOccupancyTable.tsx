"use client";

import { useState } from "react";
import { formatPercent, MONTH_LABELS_SHORT } from "@/lib/format";
import type { PropertyOccupancyResult } from "@/lib/vrplatform";

type SortKey = "reference" | "avgFillRate";

/** Rouge (peu rempli) → vert (bien rempli), sur l'échelle 0–100 % du mois. */
function fillRateBadgeStyle(fillRate: number): { backgroundColor: string; color: string } {
  const hue = Math.max(0, Math.min(1, fillRate)) * 130;
  return {
    backgroundColor: `hsl(${hue} 85% 94%)`,
    color: `hsl(${hue} 70% 30%)`,
  };
}

function avgFillRate(property: PropertyOccupancyResult): number {
  if (property.months.length === 0) return 0;
  return property.months.reduce((sum, m) => sum + m.fillRate, 0) / property.months.length;
}

export function PropertyOccupancyTable() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 4 + i);

  const [year, setYear] = useState(currentYear);
  const [selectedMonths, setSelectedMonths] = useState<number[]>([now.getMonth() + 1]);
  const [sortKey, setSortKey] = useState<SortKey>("reference");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [properties, setProperties] = useState<PropertyOccupancyResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleMonth(month: number) {
    setSelectedMonths((prev) =>
      prev.includes(month) ? prev.filter((m) => m !== month) : [...prev, month].sort((a, b) => a - b)
    );
  }

  async function load() {
    if (selectedMonths.length === 0) {
      setError("Sélectionne au moins un mois.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/finance/occupancy?year=${year}&months=${selectedMonths.join(",")}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setProperties(null);
      } else {
        setProperties(data.properties);
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

  const sortedProperties = properties
    ? [...properties].sort((a, b) => {
        const cmp = sortKey === "reference" ? a.reference.localeCompare(b.reference, "fr") : avgFillRate(a) - avgFillRate(b);
        return direction === "asc" ? cmp : -cmp;
      })
    : null;

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

      {error && <p className="text-[13px] text-red-600">{error}</p>}

      {sortedProperties && !loading && !error && (
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-black/10 text-left text-[12px] uppercase tracking-wide">
                <th className="py-2 pr-3">
                  <button
                    type="button"
                    onClick={() => handleSort("reference")}
                    className={`inline-flex items-center gap-1 transition ${
                      sortKey === "reference" ? "text-[#1d1d1f]" : "text-[#6e6e73] hover:text-[#1d1d1f]"
                    }`}
                  >
                    Référence
                    {sortKey === "reference" && <span aria-hidden>{direction === "asc" ? "↑" : "↓"}</span>}
                  </button>
                </th>
                {sortedProperties[0]?.months.map((m) => (
                  <th key={m.month} className="py-2 pr-3">
                    {MONTH_LABELS_SHORT[m.month - 1]}
                  </th>
                ))}
                {sortedProperties[0]?.months.length !== 1 && (
                  <th className="py-2 pr-3">
                    <button
                      type="button"
                      onClick={() => handleSort("avgFillRate")}
                      className={`inline-flex items-center gap-1 transition ${
                        sortKey === "avgFillRate" ? "text-[#1d1d1f]" : "text-[#6e6e73] hover:text-[#1d1d1f]"
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
                <tr key={property.propertyId} className="border-b border-black/5">
                  <td className="py-2 pr-3 font-medium text-[#1d1d1f]">
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
                    <td key={m.month} className="py-2 pr-3">
                      <span
                        className="inline-block rounded-full px-2.5 py-0.5 text-[13px] font-medium"
                        style={fillRateBadgeStyle(m.fillRate)}
                      >
                        {formatPercent(m.fillRate)}
                      </span>
                    </td>
                  ))}
                  {property.months.length !== 1 && (
                    <td className="py-2 pr-3">
                      <span
                        className="inline-block rounded-full px-2.5 py-0.5 text-[13px] font-semibold"
                        style={fillRateBadgeStyle(avgFillRate(property))}
                      >
                        {formatPercent(avgFillRate(property))}
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!properties && !loading && !error && (
        <p className="text-[13px] text-[#6e6e73]">Choisis une année, un ou plusieurs mois, puis charge les données.</p>
      )}
    </div>
  );
}
