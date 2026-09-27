"use client";

import { useState } from "react";
import { PropertyOccupancyTable } from "./PropertyOccupancyTable";
import { PropertyFinanceTable } from "./PropertyFinanceTable";
import { PropertyCleaningTable } from "./PropertyCleaningTable";
import { PropertyBonusTable } from "./PropertyBonusTable";
import { PropertyOwnerComparisonTable } from "./PropertyOwnerComparisonTable";
import { PropertyReservationsTable } from "./PropertyReservationsTable";
import { PropertyAnalysisTable } from "./PropertyAnalysisTable";
import type { RentType } from "@/lib/types";

type Tab = "occupancy" | "finance" | "cleaning" | "bonus" | "owner-comparison" | "reservations" | "analysis";

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
      </div>
      </div>

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

      {tab === "bonus" && (
        <section className="card space-y-3 p-5">
          <h2 className="text-[18px] font-semibold text-[#1d1d1f]">Bonus Ménage</h2>
          <PropertyBonusTable properties={properties} />
        </section>
      )}

      {tab === "owner-comparison" && (
        <section className="card space-y-3 p-5">
          <h2 className="text-[18px] font-semibold text-[#1d1d1f]">Owner</h2>
          <PropertyOwnerComparisonTable properties={properties} />
        </section>
      )}

      {tab === "reservations" && (
        <section className="card space-y-3 p-5">
          <h2 className="text-[18px] font-semibold text-[#1d1d1f]">Réservations</h2>
          <PropertyReservationsTable properties={properties} />
        </section>
      )}

      {tab === "analysis" && (
        <section className="card space-y-3 p-5">
          <h2 className="text-[18px] font-semibold text-[#1d1d1f]">Analyse</h2>
          <PropertyAnalysisTable properties={properties} />
        </section>
      )}
    </div>
  );
}
