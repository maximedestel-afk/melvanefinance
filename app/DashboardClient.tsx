"use client";

import { useState } from "react";
import { PropertyOccupancyTable } from "./PropertyOccupancyTable";
import { PropertyFinanceTable } from "./PropertyFinanceTable";
import { PropertyCleaningTable } from "./PropertyCleaningTable";
import { PropertyBonusTable } from "./PropertyBonusTable";
import { PropertyOwnerComparisonTable } from "./PropertyOwnerComparisonTable";
import { PropertyReservationsTable } from "./PropertyReservationsTable";
import { PropertyAnalysisTable } from "./PropertyAnalysisTable";
import { PropertyTrendsTable } from "./PropertyTrendsTable";
import type { RentType } from "@/lib/types";

type Tab = "occupancy" | "finance" | "cleaning" | "bonus" | "owner-comparison" | "reservations" | "analysis" | "trends";

export function DashboardClient({
  properties,
}: {
  properties: {
    id: string;
    reference: string;
    name: string | null;
    tags: string[];
    rentType: RentType | null;
    ownerEmail: string | null;
    cleaningProviderName: string | null;
    bonusFdPercent: number | null;
  }[];
}) {
  const [tab, setTab] = useState<Tab>("occupancy");
  const [analysisRequest, setAnalysisRequest] = useState<
    | { propertyId: string; year: number; month: number; token: number }
    | { propertyId: string; startDate: string; endDate: string; token: number }
    | null
  >(null);

  function openAnalysis(propertyId: string, year: number, month: number) {
    setAnalysisRequest({ propertyId, year, month, token: Date.now() });
    setTab("analysis");
  }

  function openAnalysisRange(propertyId: string, startDate: string, endDate: string) {
    setAnalysisRequest({ propertyId, startDate, endDate, token: Date.now() });
    setTab("analysis");
  }

  return (
    <div className="space-y-8">
      <div className="sticky top-0 z-20 -mx-4 bg-[#f5f5f7]/95 px-4 py-3 backdrop-blur-sm">
      <div className="flex overflow-hidden rounded-[10px] border border-black/10 w-fit">
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
        <button
          type="button"
          onClick={() => setTab("bonus")}
          className={`px-4 py-2 text-[14px] font-medium transition ${
            tab === "bonus" ? "bg-[#0071e3] text-white" : "bg-white text-[#1d1d1f] hover:bg-black/[0.04]"
          }`}
        >
          Bonus Ménage
        </button>
        <button
          type="button"
          onClick={() => setTab("owner-comparison")}
          className={`px-4 py-2 text-[14px] font-medium transition ${
            tab === "owner-comparison" ? "bg-[#0071e3] text-white" : "bg-white text-[#1d1d1f] hover:bg-black/[0.04]"
          }`}
        >
          Owner
        </button>
        <button
          type="button"
          onClick={() => setTab("reservations")}
          className={`px-4 py-2 text-[14px] font-medium transition ${
            tab === "reservations" ? "bg-[#0071e3] text-white" : "bg-white text-[#1d1d1f] hover:bg-black/[0.04]"
          }`}
        >
          Réservations
        </button>
        <button
          type="button"
          onClick={() => setTab("analysis")}
          className={`px-4 py-2 text-[14px] font-medium transition ${
            tab === "analysis" ? "bg-[#0071e3] text-white" : "bg-white text-[#1d1d1f] hover:bg-black/[0.04]"
          }`}
        >
          Analyse
        </button>
        <button
          type="button"
          onClick={() => setTab("trends")}
          className={`px-4 py-2 text-[14px] font-medium transition ${
            tab === "trends" ? "bg-[#0071e3] text-white" : "bg-white text-[#1d1d1f] hover:bg-black/[0.04]"
          }`}
        >
          Tendances
        </button>
      </div>
      </div>

      {/* Chaque onglet reste monté en permanence (juste masqué en CSS) au
          lieu d'être démonté/remonté au changement d'onglet, pour que ses
          données déjà chargées et ses filtres restent affichés quand on y
          revient, plutôt que de retomber sur une page vide à chaque fois. */}
      <section className={`card space-y-3 p-5 ${tab === "occupancy" ? "" : "hidden"}`}>
        <h2 className="text-[18px] font-semibold text-[#1d1d1f]">Remplissage</h2>
        <PropertyOccupancyTable properties={properties} />
      </section>

      <section className={`card space-y-3 p-5 ${tab === "finance" ? "" : "hidden"}`}>
        <h2 className="text-[18px] font-semibold text-[#1d1d1f]">Revenus</h2>
        <PropertyFinanceTable properties={properties} />
      </section>

      <section className={`card space-y-3 p-5 ${tab === "cleaning" ? "" : "hidden"}`}>
        <h2 className="text-[18px] font-semibold text-[#1d1d1f]">Ménage</h2>
        <PropertyCleaningTable properties={properties} />
      </section>

      <section className={`card space-y-3 p-5 ${tab === "bonus" ? "" : "hidden"}`}>
        <h2 className="text-[18px] font-semibold text-[#1d1d1f]">Bonus Ménage</h2>
        <PropertyBonusTable properties={properties} />
      </section>

      <section className={`card space-y-3 p-5 ${tab === "owner-comparison" ? "" : "hidden"}`}>
        <h2 className="text-[18px] font-semibold text-[#1d1d1f]">Owner</h2>
        <PropertyOwnerComparisonTable properties={properties} onOpenAnalysis={openAnalysis} />
      </section>

      <section className={`card space-y-3 p-5 ${tab === "reservations" ? "" : "hidden"}`}>
        <h2 className="text-[18px] font-semibold text-[#1d1d1f]">Réservations</h2>
        <PropertyReservationsTable properties={properties} />
      </section>

      <section className={`card space-y-3 p-5 ${tab === "analysis" ? "" : "hidden"}`}>
        <h2 className="text-[18px] font-semibold text-[#1d1d1f]">Analyse</h2>
        <PropertyAnalysisTable properties={properties} request={analysisRequest} />
      </section>

      <section className={`card space-y-3 p-5 ${tab === "trends" ? "" : "hidden"}`}>
        <h2 className="text-[18px] font-semibold text-[#1d1d1f]">Tendances</h2>
        <PropertyTrendsTable properties={properties} onOpenAnalysisRange={openAnalysisRange} />
      </section>
    </div>
  );
}
