"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatEuros, formatPercent, MONTH_LABELS_SHORT } from "@/lib/format";
import type { PropertyMonthlyResult } from "@/lib/vrplatform";

interface OwnerRow {
  month: number;
  actualRevenueCents: number;
  actualFillRate: number;
  targetRevenueCents: number;
  expensesCents: number;
  commissionCents: number;
  netRevenueCents: number;
}

function buildOwnerRows(
  property: PropertyMonthlyResult,
  selectedMonths: number[],
  targetFillRate: number
): { rows: OwnerRow[]; avgNightlyRateCents: number | null } {
  const visible = property.months.filter(
    (m) => selectedMonths.includes(m.month) && (m.netRevenueCents !== 0 || m.nightsBooked > 0)
  );
  const totalRevenueCents = visible.reduce((sum, m) => sum + m.netRevenueCents, 0);
  const totalNights = visible.reduce((sum, m) => sum + m.nightsBooked, 0);
  const avgNightlyRateCents = totalNights > 0 ? totalRevenueCents / totalNights : null;
  const commissionPercent = property.commissionPercent ?? 0;

  const rows = visible.map((m) => {
    const targetRevenueCents =
      avgNightlyRateCents != null ? avgNightlyRateCents * m.daysInMonth * (targetFillRate / 100) : 0;
    const expensesCents = 0;
    const commissionCents = targetRevenueCents * (commissionPercent / 100);
    const netRevenueCents = targetRevenueCents - commissionCents - expensesCents;
    return {
      month: m.month,
      actualRevenueCents: m.netRevenueCents,
      actualFillRate: m.fillRate,
      targetRevenueCents,
      expensesCents,
      commissionCents,
      netRevenueCents,
    };
  });

  return { rows, avgNightlyRateCents };
}

function PropertyOwnerCard({
  property,
  year,
  selectedMonths,
  targetFillRate,
}: {
  property: PropertyMonthlyResult;
  year: number;
  selectedMonths: number[];
  targetFillRate: number;
}) {
  const { rows, avgNightlyRateCents } = useMemo(
    () => buildOwnerRows(property, selectedMonths, targetFillRate),
    [property, selectedMonths, targetFillRate]
  );
  const commissionPercent = property.commissionPercent;

  return (
    <div className="card space-y-3 p-5">
      <div>
        <h2 className="text-[16px] font-semibold text-[#1d1d1f]">{property.reference}</h2>
        {avgNightlyRateCents != null && (
          <p className="text-[13px] text-[#6e6e73]">Tarif moyen par nuit ≈ {formatEuros(avgNightlyRateCents / 100)}</p>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-[13px] text-[#6e6e73]">Aucune donnée sur cette période.</p>
      ) : (
        <div className="overflow-hidden rounded-[14px] border border-black/[0.06]">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-black/[0.08] bg-black/[0.015]">
                  <th className="py-2.5 pl-4 pr-2.5 text-left text-[12px] font-medium text-[#86868b]">Mois</th>
                  <th className="py-2.5 px-2.5 text-right text-[12px] font-medium text-[#86868b]">Revenu réel</th>
                  <th className="py-2.5 px-2.5 text-right text-[12px] font-medium text-[#86868b]">Remplissage réel</th>
                  <th className="py-2.5 px-2.5 text-right text-[12px] font-medium text-[#86868b]">
                    Revenu à {targetFillRate}%
                  </th>
                  <th className="py-2.5 px-2.5 text-right text-[12px] font-medium text-[#86868b]">Dépenses</th>
                  <th className="py-2.5 px-2.5 text-right text-[12px] font-medium text-[#86868b]">
                    Commission{commissionPercent != null ? ` (${commissionPercent}%)` : ""}
                  </th>
                  <th className="py-2.5 pl-2.5 pr-4 text-right text-[12px] font-medium text-[#86868b]">Revenu net</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.month} className="border-b border-black/[0.05] transition-colors last:border-b-0 hover:bg-black/[0.015]">
                    <td className="py-2.5 pl-4 pr-2.5 font-medium text-[#1d1d1f]">
                      {MONTH_LABELS_SHORT[row.month - 1]} {year}
                    </td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums text-[#1d1d1f]">
                      {formatEuros(row.actualRevenueCents / 100)}
                    </td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums text-[#1d1d1f]">
                      {formatPercent(row.actualFillRate)}
                    </td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums text-[#1d1d1f]">
                      {formatEuros(row.targetRevenueCents / 100)}
                    </td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums text-[#1d1d1f]">
                      {formatEuros(row.expensesCents / 100)}
                    </td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums text-[#1d1d1f]">
                      {formatEuros(row.commissionCents / 100)}
                    </td>
                    <td className="py-2.5 pl-2.5 pr-4 text-right tabular-nums font-semibold text-[#1d1d1f]">
                      {formatEuros(row.netRevenueCents / 100)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export function OwnerDashboardClient({ year, properties }: { year: number; properties: PropertyMonthlyResult[] }) {
  const router = useRouter();
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 3 }, (_, i) => currentYear - 1 + i);

  const [selectedMonths, setSelectedMonths] = useState<number[]>(() => Array.from({ length: 12 }, (_, i) => i + 1));
  const [targetFillRate, setTargetFillRate] = useState(85);

  function toggleMonth(month: number) {
    setSelectedMonths((prev) =>
      prev.includes(month) ? prev.filter((m) => m !== month) : [...prev, month].sort((a, b) => a - b)
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="field-label" htmlFor="owner-year">
            Année
          </label>
          <select
            id="owner-year"
            value={year}
            onChange={(e) => router.push(`/owner?year=${e.target.value}`)}
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

        <div>
          <label className="field-label" htmlFor="target-fill-rate">
            Taux de remplissage cible
          </label>
          <div className="mt-1 flex items-center gap-1.5">
            <input
              id="target-fill-rate"
              type="number"
              min={0}
              max={100}
              value={targetFillRate}
              onChange={(e) => setTargetFillRate(Math.max(0, Math.min(100, Number.parseInt(e.target.value, 10) || 0)))}
              className="w-20 rounded-[10px] border border-black/10 bg-white px-2.5 py-2 text-[14px] text-[#1d1d1f] focus:border-[#0071e3] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
            />
            <span className="text-[14px] text-[#6e6e73]">%</span>
          </div>
        </div>
      </div>

      {properties.map((property) => (
        <PropertyOwnerCard
          key={property.propertyId}
          property={property}
          year={year}
          selectedMonths={selectedMonths}
          targetFillRate={targetFillRate}
        />
      ))}
    </div>
  );
}
