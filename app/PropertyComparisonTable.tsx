"use client";

import { useMemo, useState } from "react";
import { formatEuros, formatPercent } from "@/lib/format";
import type { PropertyMonthlyResult } from "@/lib/vrplatform";

type SortKey = "reference" | "rents" | "channelFees" | "netRevenue" | "fillRate" | "diff";

interface Row {
  propertyId: string;
  reference: string;
  name: string | null;
  rentsCents: number;
  channelFeesCents: number;
  netRevenueCents: number;
  avgFillRate: number;
  isFixedRent: boolean;
  fixedRentAnnualCents: number | null;
  diffCents: number | null;
  notFoundReferences: string[];
}

function toRow(property: PropertyMonthlyResult): Row {
  const rentsCents = property.months.reduce((sum, m) => sum + m.rentsCents, 0);
  const channelFeesCents = property.months.reduce((sum, m) => sum + m.channelFeesCents, 0);
  const netRevenueCents = property.months.reduce((sum, m) => sum + m.netRevenueCents, 0);
  const avgFillRate = property.months.reduce((sum, m) => sum + m.fillRate, 0) / property.months.length;
  const fixedRentAnnualCents = property.isFixedRent && property.fixedRentAmountCents != null
    ? property.fixedRentAmountCents * 12
    : null;
  const diffCents = fixedRentAnnualCents != null ? netRevenueCents - fixedRentAnnualCents : null;
  return {
    propertyId: property.propertyId,
    reference: property.reference,
    name: property.name,
    rentsCents,
    channelFeesCents,
    netRevenueCents,
    avgFillRate,
    isFixedRent: property.isFixedRent,
    fixedRentAnnualCents,
    diffCents,
    notFoundReferences: property.notFoundReferences,
  };
}

function SortHeader({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  direction: "asc" | "desc";
  onSort: (key: SortKey) => void;
}) {
  const isActive = activeKey === sortKey;
  return (
    <th className="py-2 pr-3">
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 transition ${isActive ? "text-[#1d1d1f]" : "text-[#6e6e73] hover:text-[#1d1d1f]"}`}
      >
        {label}
        {isActive && <span aria-hidden>{direction === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}

export function PropertyComparisonTable({ properties }: { properties: PropertyMonthlyResult[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("netRevenue");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");

  const rows = useMemo(() => properties.map(toRow), [properties]);

  const sortedRows = useMemo(() => {
    const sorted = [...rows].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "reference":
          cmp = a.reference.localeCompare(b.reference, "fr");
          break;
        case "rents":
          cmp = a.rentsCents - b.rentsCents;
          break;
        case "channelFees":
          cmp = a.channelFeesCents - b.channelFeesCents;
          break;
        case "netRevenue":
          cmp = a.netRevenueCents - b.netRevenueCents;
          break;
        case "fillRate":
          cmp = a.avgFillRate - b.avgFillRate;
          break;
        case "diff":
          cmp = (a.diffCents ?? 0) - (b.diffCents ?? 0);
          break;
      }
      return direction === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [rows, sortKey, direction]);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDirection("desc");
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[14px]">
        <thead>
          <tr className="border-b border-black/10 text-left text-[12px] uppercase tracking-wide">
            <SortHeader label="Bien" sortKey="reference" activeKey={sortKey} direction={direction} onSort={handleSort} />
            <SortHeader label="Rents" sortKey="rents" activeKey={sortKey} direction={direction} onSort={handleSort} />
            <SortHeader
              label="Channel Fees"
              sortKey="channelFees"
              activeKey={sortKey}
              direction={direction}
              onSort={handleSort}
            />
            <SortHeader
              label="Net Commissionable Revenue"
              sortKey="netRevenue"
              activeKey={sortKey}
              direction={direction}
              onSort={handleSort}
            />
            <SortHeader
              label="Taux de remplissage moyen"
              sortKey="fillRate"
              activeKey={sortKey}
              direction={direction}
              onSort={handleSort}
            />
            <SortHeader label="Écart vs loyer fixe" sortKey="diff" activeKey={sortKey} direction={direction} onSort={handleSort} />
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => (
            <tr key={row.propertyId} className="border-b border-black/5">
              <td className="py-2 pr-3 text-[#1d1d1f]">
                <span className="font-medium">{row.reference}</span>
                {row.name && <span className="ml-1.5 text-[#6e6e73]">{row.name}</span>}
                {row.notFoundReferences.length > 0 && (
                  <span
                    title={`Référence VRPlatform introuvable : ${row.notFoundReferences.join(", ")}`}
                    className="ml-1.5 text-amber-600"
                  >
                    ⚠
                  </span>
                )}
              </td>
              <td className="py-2 pr-3 text-[#1d1d1f]">{formatEuros(row.rentsCents / 100)}</td>
              <td className="py-2 pr-3 text-[#1d1d1f]">{formatEuros(row.channelFeesCents / 100)}</td>
              <td className="py-2 pr-3 font-semibold text-[#1d1d1f]">{formatEuros(row.netRevenueCents / 100)}</td>
              <td className="py-2 pr-3 text-[#1d1d1f]">{formatPercent(row.avgFillRate)}</td>
              <td
                className={`py-2 pr-3 font-semibold ${
                  row.diffCents == null ? "text-[#6e6e73]" : row.diffCents >= 0 ? "text-emerald-600" : "text-red-600"
                }`}
              >
                {row.diffCents != null ? `${row.diffCents >= 0 ? "+" : ""}${formatEuros(row.diffCents / 100)}` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
