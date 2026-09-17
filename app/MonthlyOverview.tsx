"use client";

import { useMemo } from "react";
import { BarChart } from "./BarChart";
import { formatEuros, formatPercent, MONTH_LABELS_SHORT } from "@/lib/format";
import type { PropertyMonthlyResult } from "@/lib/vrplatform";

export function MonthlyOverview({ properties }: { properties: PropertyMonthlyResult[] }) {
  const { monthlyData, totalRents, totalChannelFees, totalNetRevenue, avgFillRate } = useMemo(() => {
    const months = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      rentsCents: 0,
      channelFeesCents: 0,
      netRevenueCents: 0,
      nightsBooked: 0,
      // Nuits possibles pour tout le portefeuille sur ce mois (jours du mois
      // x nombre de biens) — même valeur pour chaque bien, prise sur le
      // premier disponible.
      possibleNights: (properties[0]?.months[i]?.daysInMonth ?? 0) * properties.length,
    }));
    for (const property of properties) {
      property.months.forEach((m, i) => {
        months[i].rentsCents += m.rentsCents;
        months[i].channelFeesCents += m.channelFeesCents;
        months[i].netRevenueCents += m.netRevenueCents;
        months[i].nightsBooked += m.nightsBooked;
      });
    }
    const monthlyData = months.map((m, i) => ({ label: MONTH_LABELS_SHORT[i], value: m.netRevenueCents / 100 }));
    const totalRents = months.reduce((sum, m) => sum + m.rentsCents, 0);
    const totalChannelFees = months.reduce((sum, m) => sum + m.channelFeesCents, 0);
    const totalNetRevenue = months.reduce((sum, m) => sum + m.netRevenueCents, 0);
    const totalNights = months.reduce((sum, m) => sum + m.nightsBooked, 0);
    const totalPossibleNights = months.reduce((sum, m) => sum + m.possibleNights, 0);
    const avgFillRate = totalPossibleNights > 0 ? totalNights / totalPossibleNights : 0;
    return { monthlyData, totalRents, totalChannelFees, totalNetRevenue, avgFillRate };
  }, [properties]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card p-4">
          <p className="text-[12px] uppercase tracking-wide text-[#6e6e73]">Rents</p>
          <p className="mt-1 text-[20px] font-semibold text-[#1d1d1f]">{formatEuros(totalRents / 100)}</p>
        </div>
        <div className="card p-4">
          <p className="text-[12px] uppercase tracking-wide text-[#6e6e73]">Channel Fees</p>
          <p className="mt-1 text-[20px] font-semibold text-[#1d1d1f]">{formatEuros(totalChannelFees / 100)}</p>
        </div>
        <div className="card p-4">
          <p className="text-[12px] uppercase tracking-wide text-[#6e6e73]">Net Commissionable Revenue</p>
          <p className="mt-1 text-[20px] font-semibold text-[#1d1d1f]">{formatEuros(totalNetRevenue / 100)}</p>
        </div>
        <div className="card p-4">
          <p className="text-[12px] uppercase tracking-wide text-[#6e6e73]">Taux de remplissage moyen</p>
          <p className="mt-1 text-[20px] font-semibold text-[#1d1d1f]">{formatPercent(avgFillRate)}</p>
        </div>
      </div>
      <BarChart data={monthlyData} formatValue={(v) => formatEuros(v)} />
    </div>
  );
}
