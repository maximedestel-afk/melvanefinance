"use client";

import { useState } from "react";
import { BarChart } from "./BarChart";
import { formatEuros, formatPercent } from "@/lib/format";
import type { YearlyTotal } from "@/lib/vrplatform";

type Metric = "revenue" | "fillRate";

export function TrendsSection({ properties }: { properties: { id: string; reference: string; name: string | null }[] }) {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 4 + i);

  const [propertyId, setPropertyId] = useState<string>("");
  const [metric, setMetric] = useState<Metric>("revenue");
  const [totals, setTotals] = useState<YearlyTotal[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ years: years.join(",") });
      if (propertyId) params.set("propertyId", propertyId);
      const res = await fetch(`/api/finance/trends?${params.toString()}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setTotals(null);
      } else {
        setTotals(data.years);
      }
    } catch {
      setError("Impossible de charger les tendances.");
    } finally {
      setLoading(false);
    }
  }

  const chartData = totals?.map((t) => ({
    label: String(t.year),
    value: metric === "revenue" ? t.netRevenueCents / 100 : t.fillRate * 100,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="field-label" htmlFor="trends-property">
            Bien
          </label>
          <select
            id="trends-property"
            value={propertyId}
            onChange={(e) => {
              setPropertyId(e.target.value);
              setTotals(null);
            }}
            className="mt-1 rounded-[10px] border border-black/10 bg-white px-3 py-2 text-[14px] text-[#1d1d1f] shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus:border-[#0071e3] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
          >
            <option value="">Tout le portefeuille</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.reference}
                {p.name ? ` — ${p.name}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="flex overflow-hidden rounded-[10px] border border-black/10">
          <button
            type="button"
            onClick={() => setMetric("revenue")}
            className={`px-3.5 py-2 text-[13px] font-medium transition ${
              metric === "revenue" ? "bg-[#0071e3] text-white" : "bg-white text-[#1d1d1f] hover:bg-black/[0.04]"
            }`}
          >
            Revenu net
          </button>
          <button
            type="button"
            onClick={() => setMetric("fillRate")}
            className={`px-3.5 py-2 text-[13px] font-medium transition ${
              metric === "fillRate" ? "bg-[#0071e3] text-white" : "bg-white text-[#1d1d1f] hover:bg-black/[0.04]"
            }`}
          >
            Taux de remplissage
          </button>
        </div>
        <button type="button" onClick={load} disabled={loading} className="btn-secondary btn-sm">
          {loading ? "Chargement…" : totals ? "Actualiser" : "Charger les tendances"}
        </button>
      </div>

      {error && <p className="text-[13px] text-red-600">{error}</p>}

      {chartData && (
        <BarChart
          data={chartData}
          formatValue={(v) => (metric === "revenue" ? formatEuros(v) : formatPercent(v / 100))}
        />
      )}

      {!totals && !loading && !error && (
        <p className="text-[13px] text-[#6e6e73]">
          Charge {years[0]}–{years[years.length - 1]} pour le portefeuille entier ou un bien précis.
        </p>
      )}
    </div>
  );
}
