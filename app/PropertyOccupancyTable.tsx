"use client";

import { useEffect, useState } from "react";
import { formatPercent, MONTH_LABELS_SHORT } from "@/lib/format";
import type { PropertyOccupancy } from "@/lib/vrplatform";

type SortKey = "reference" | "fillRate";

/** Rouge (peu rempli) → vert (bien rempli), sur l'échelle 0–100 % du mois. */
function fillRateBadgeStyle(fillRate: number): { backgroundColor: string; color: string } {
  const hue = Math.max(0, Math.min(1, fillRate)) * 130;
  return {
    backgroundColor: `hsl(${hue} 85% 94%)`,
    color: `hsl(${hue} 70% 30%)`,
  };
}

export function PropertyOccupancyTable() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 4 + i);

  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [sortKey, setSortKey] = useState<SortKey>("fillRate");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [properties, setProperties] = useState<PropertyOccupancy[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/finance/occupancy?year=${year}&month=${month}`);
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
    })();
  }, [year, month]);

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
        const cmp = sortKey === "reference" ? a.reference.localeCompare(b.reference, "fr") : a.fillRate - b.fillRate;
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
          <label className="field-label" htmlFor="occupancy-month">
            Mois
          </label>
          <select
            id="occupancy-month"
            value={month}
            onChange={(e) => setMonth(Number.parseInt(e.target.value, 10))}
            className="mt-1 rounded-[10px] border border-black/10 bg-white px-3 py-2 text-[14px] text-[#1d1d1f] shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus:border-[#0071e3] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
          >
            {MONTH_LABELS_SHORT.map((label, i) => (
              <option key={label} value={i + 1}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading && <p className="text-[13px] text-[#6e6e73]">Chargement du taux de remplissage…</p>}
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
                <th className="py-2 pr-3">
                  <button
                    type="button"
                    onClick={() => handleSort("fillRate")}
                    className={`inline-flex items-center gap-1 transition ${
                      sortKey === "fillRate" ? "text-[#1d1d1f]" : "text-[#6e6e73] hover:text-[#1d1d1f]"
                    }`}
                  >
                    Taux de remplissage
                    {sortKey === "fillRate" && <span aria-hidden>{direction === "asc" ? "↑" : "↓"}</span>}
                  </button>
                </th>
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
                  <td className="py-2 pr-3">
                    <span
                      className="inline-block rounded-full px-2.5 py-0.5 text-[13px] font-medium"
                      style={fillRateBadgeStyle(property.fillRate)}
                    >
                      {formatPercent(property.fillRate)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
