"use client";

import { useEffect, useState } from "react";
import { MonthlyOverview } from "./MonthlyOverview";
import { PropertyComparisonTable } from "./PropertyComparisonTable";
import { PropertyOccupancyTable } from "./PropertyOccupancyTable";
import { PropertyFinanceTable } from "./PropertyFinanceTable";
import { PropertyCleaningTable } from "./PropertyCleaningTable";
import { TrendsSection } from "./TrendsSection";
import type { PropertyMonthlyResult } from "@/lib/vrplatform";
import type { RentType } from "@/lib/types";

type Tab = "overview" | "occupancy" | "finance" | "cleaning";

export function DashboardClient({
  properties,
}: {
  properties: {
    id: string;
    reference: string;
    name: string | null;
    tags: string[];
    rentType: RentType | null;
    cleaningProviderName: string | null;
  }[];
}) {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 3 + i);

  const [tab, setTab] = useState<Tab>("overview");
  const [year, setYear] = useState(currentYear);
  const [results, setResults] = useState<PropertyMonthlyResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/finance/monthly?year=${year}`);
        const data = await res.json();
        if (data.error) {
          setError(data.error);
          setResults(null);
        } else {
          setResults(data.properties);
        }
      } catch {
        setError("Impossible de charger les données VRPlatform.");
      } finally {
        setLoading(false);
      }
    })();
  }, [year]);

  return (
    <div className="space-y-8">
      <div className="flex overflow-hidden rounded-[10px] border border-black/10 w-fit">
        <button
          type="button"
          onClick={() => setTab("overview")}
          className={`px-4 py-2 text-[14px] font-medium transition ${
            tab === "overview" ? "bg-[#0071e3] text-white" : "bg-white text-[#1d1d1f] hover:bg-black/[0.04]"
          }`}
        >
          Vue d&apos;ensemble
        </button>
        <button
          type="button"
          onClick={() => setTab("occupancy")}
          className={`px-4 py-2 text-[14px] font-medium transition ${
            tab === "occupancy" ? "bg-[#0071e3] text-white" : "bg-white text-[#1d1d1f] hover:bg-black/[0.04]"
          }`}
        >
          Remplissage
        </button>
        <button
          type="button"
          onClick={() => setTab("finance")}
          className={`px-4 py-2 text-[14px] font-medium transition ${
            tab === "finance" ? "bg-[#0071e3] text-white" : "bg-white text-[#1d1d1f] hover:bg-black/[0.04]"
          }`}
        >
          Revenus
        </button>
        <button
          type="button"
          onClick={() => setTab("cleaning")}
          className={`px-4 py-2 text-[14px] font-medium transition ${
            tab === "cleaning" ? "bg-[#0071e3] text-white" : "bg-white text-[#1d1d1f] hover:bg-black/[0.04]"
          }`}
        >
          Ménage
        </button>
      </div>

      {tab === "overview" && (
        <div className="space-y-8">
          <div className="flex items-center justify-between">
            <h2 className="text-[18px] font-semibold text-[#1d1d1f]">Vue consolidée</h2>
            <select
              value={year}
              onChange={(e) => setYear(Number.parseInt(e.target.value, 10))}
              className="rounded-[10px] border border-black/10 bg-white px-3 py-1.5 text-[14px] text-[#1d1d1f] shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus:border-[#0071e3] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          {loading && <p className="text-[13px] text-[#6e6e73]">Chargement des données VRPlatform…</p>}
          {error && <p className="text-[13px] text-red-600">{error}</p>}

          {results && !loading && !error && (
            <>
              <section className="card p-5">
                <MonthlyOverview properties={results} />
              </section>

              <section className="card space-y-3 p-5">
                <h2 className="text-[18px] font-semibold text-[#1d1d1f]">Comparaison des biens — {year}</h2>
                <PropertyComparisonTable properties={results} />
              </section>
            </>
          )}

          <section className="card space-y-3 p-5">
            <h2 className="text-[18px] font-semibold text-[#1d1d1f]">Tendances</h2>
            <TrendsSection properties={properties} />
          </section>
        </div>
      )}

      {tab === "occupancy" && (
        <section className="card space-y-3 p-5">
          <h2 className="text-[18px] font-semibold text-[#1d1d1f]">Remplissage</h2>
          <PropertyOccupancyTable properties={properties} />
        </section>
      )}

      {tab === "finance" && (
        <section className="card space-y-3 p-5">
          <h2 className="text-[18px] font-semibold text-[#1d1d1f]">Revenus</h2>
          <PropertyFinanceTable properties={properties} />
        </section>
      )}

      {tab === "cleaning" && (
        <section className="card space-y-3 p-5">
          <h2 className="text-[18px] font-semibold text-[#1d1d1f]">Ménage</h2>
          <PropertyCleaningTable properties={properties} />
        </section>
      )}
    </div>
  );
}
