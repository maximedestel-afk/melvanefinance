"use client";

import { Fragment, useMemo, useState } from "react";
import { formatEuros, formatPercent, todayIso } from "@/lib/format";
import type { RentType } from "@/lib/types";

interface RentProperty {
  id: string;
  reference: string;
  name: string | null;
  rentType: RentType | null;
  rentAmount: number | null;
  rentAmountEuros: number | null;
  chargesAmountEuros: number | null;
  commissionPercent: number | null;
  ownerLastName: string | null;
  ownerFirstName: string | null;
}

type RentTypeFilter = "fixe" | "fixe_variable" | "both";

const RENT_TYPE_LABELS: Record<"fixe" | "fixe_variable", string> = {
  fixe: "Loyer fixe",
  fixe_variable: "Loyer fixe + variable",
};

function escapeCsvField(value: string): string {
  if (/[";\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function PropertyRentListTable({ properties }: { properties: RentProperty[] }) {
  const [rentTypeFilter, setRentTypeFilter] = useState<RentTypeFilter>("both");
  const [search, setSearch] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(["fixe", "fixe_variable"])
  );

  function toggleGroup(rentType: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(rentType)) next.delete(rentType);
      else next.add(rentType);
      return next;
    });
  }

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return properties
      .filter((p): p is RentProperty & { rentType: "fixe" | "fixe_variable" } =>
        p.rentType === "fixe" || p.rentType === "fixe_variable"
      )
      .filter((p) => rentTypeFilter === "both" || p.rentType === rentTypeFilter)
      .filter((p) => {
        if (!needle) return true;
        const owner = `${p.ownerFirstName ?? ""} ${p.ownerLastName ?? ""}`.toLowerCase();
        return (
          p.reference.toLowerCase().includes(needle) ||
          (p.name ?? "").toLowerCase().includes(needle) ||
          owner.includes(needle)
        );
      })
      .sort((a, b) => a.reference.localeCompare(b.reference, "fr"));
  }, [properties, rentTypeFilter, search]);

  const groups = useMemo(() => {
    const byType = new Map<"fixe" | "fixe_variable", typeof rows>();
    for (const row of rows) {
      const list = byType.get(row.rentType) ?? [];
      list.push(row);
      byType.set(row.rentType, list);
    }
    return (["fixe", "fixe_variable"] as const)
      .filter((t) => byType.has(t))
      .map((rentType) => {
        const list = byType.get(rentType)!;
        return {
          rentType,
          rows: list,
          totalCents: list.reduce((sum, p) => sum + (p.rentAmount ?? 0), 0),
        };
      });
  }, [rows]);

  const totalCents = rows.reduce((sum, p) => sum + (p.rentAmount ?? 0), 0);

  function exportExcel() {
    if (rows.length === 0) return;
    const header = ["Type de loyer", "Bien", "Nom", "Propriétaire", "Loyer", "Charges", "Total", "Commission"];
    const lines: string[][] = [header];
    for (const group of groups) {
      for (const row of group.rows) {
        const owner = `${row.ownerFirstName ?? ""} ${row.ownerLastName ?? ""}`.trim();
        lines.push([
          RENT_TYPE_LABELS[group.rentType],
          row.reference,
          row.name ?? "",
          owner,
          row.rentAmountEuros != null ? formatEuros(row.rentAmountEuros) : "",
          row.chargesAmountEuros != null ? formatEuros(row.chargesAmountEuros) : "",
          row.rentAmount != null ? formatEuros(row.rentAmount) : "",
          row.commissionPercent != null ? formatPercent(row.commissionPercent / 100) : "",
        ]);
      }
    }
    lines.push(["", "", "", "", "", "", formatEuros(totalCents), ""]);
    const content = lines.map((line) => line.map(escapeCsvField).join(";")).join("\n");
    const blob = new Blob(["﻿" + content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `loyers_${todayIso()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={rentTypeFilter}
          onChange={(e) => setRentTypeFilter(e.target.value as RentTypeFilter)}
          className="rounded-[8px] border border-black/10 px-2 py-1.5 text-[13px]"
        >
          <option value="both">Fixe + Fixe et variable</option>
          <option value="fixe">Loyer fixe</option>
          <option value="fixe_variable">Loyer fixe + variable</option>
        </select>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un bien ou un propriétaire…"
          className="rounded-[8px] border border-black/10 px-2 py-1.5 text-[13px]"
        />
        <span className="text-[12px] text-[#6e6e73]">
          {rows.length} bien{rows.length > 1 ? "s" : ""} — total {formatEuros(totalCents)}
        </span>
        <button type="button" onClick={exportExcel} disabled={rows.length === 0} className="btn-secondary btn-sm ml-auto">
          Exporter Excel (CSV)
        </button>
      </div>

      {rows.length === 0 && (
        <p className="text-[13px] text-[#6e6e73]">Aucun bien en loyer fixe ou fixe + variable pour ce filtre.</p>
      )}

      {rows.length > 0 && (
        <div className="overflow-hidden rounded-[14px] border border-black/[0.06]">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-black/[0.08] bg-black/[0.015]">
                  <th className="py-1.5 pl-3 pr-2 text-left text-[11px] font-medium text-[#86868b]">Bien</th>
                  <th className="py-1.5 px-2 text-left text-[11px] font-medium text-[#86868b]">Propriétaire</th>
                  <th className="py-1.5 px-2 text-right text-[11px] font-medium text-[#86868b]">Loyer</th>
                  <th className="py-1.5 px-2 text-right text-[11px] font-medium text-[#86868b]">Charges</th>
                  <th className="py-1.5 px-2 text-right text-[11px] font-medium text-[#86868b]">Total</th>
                  <th className="py-1.5 pl-2 pr-3 text-right text-[11px] font-medium text-[#86868b]">Commission</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => {
                  const expanded = expandedGroups.has(group.rentType);
                  return (
                    <Fragment key={group.rentType}>
                      <tr
                        className="cursor-pointer border-b border-black/[0.08] bg-[#eef3fb] hover:bg-[#dceafb]"
                        onClick={() => toggleGroup(group.rentType)}
                      >
                        <td colSpan={4} className="py-1.5 pl-3 pr-2 font-semibold text-[#1d1d1f]">
                          {expanded ? "▾" : "▸"} {RENT_TYPE_LABELS[group.rentType]} ({group.rows.length})
                        </td>
                        <td className="py-1.5 px-2 text-right font-semibold tabular-nums text-[#1d1d1f]">
                          {formatEuros(group.totalCents)}
                        </td>
                        <td className="py-1.5 pl-2 pr-3" />
                      </tr>
                      {expanded &&
                        group.rows.map((row, rowIndex) => {
                          const owner = `${row.ownerFirstName ?? ""} ${row.ownerLastName ?? ""}`.trim();
                          return (
                            <tr
                              key={row.id}
                              className={`border-b border-black/[0.04] transition-colors last:border-b-0 hover:bg-[#dceafb] ${
                                rowIndex % 2 === 0 ? "bg-white" : "bg-[#f0f6fd]"
                              }`}
                            >
                              <td className="py-1.5 pl-3 pr-2 font-medium text-[#1d1d1f]">
                                {row.reference}
                                {row.name && <div className="text-[10.5px] text-[#86868b]">{row.name}</div>}
                              </td>
                              <td className="py-1.5 px-2 text-[#1d1d1f]">
                                {owner || <span className="text-[#6e6e73]">—</span>}
                              </td>
                              <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">
                                {row.rentAmountEuros != null ? formatEuros(row.rentAmountEuros) : "—"}
                              </td>
                              <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">
                                {row.chargesAmountEuros != null ? formatEuros(row.chargesAmountEuros) : "—"}
                              </td>
                              <td className="py-1.5 px-2 text-right tabular-nums font-semibold text-[#1d1d1f]">
                                {row.rentAmount != null ? formatEuros(row.rentAmount) : "—"}
                              </td>
                              <td className="py-1.5 pl-2 pr-3 text-right tabular-nums text-[#1d1d1f]">
                                {row.commissionPercent != null ? formatPercent(row.commissionPercent / 100) : "—"}
                              </td>
                            </tr>
                          );
                        })}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
