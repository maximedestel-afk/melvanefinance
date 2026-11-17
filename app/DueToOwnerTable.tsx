"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { formatEuros, todayIso } from "@/lib/format";

interface PropertyOption {
  id: string;
  reference: string;
  name: string | null;
  extraVrplatformReferences: string[];
  ownerEmail: string | null;
  ownerLastName: string | null;
  ownerFirstName: string | null;
}

interface OwnerBalanceRow {
  listingId: string;
  reference: string;
  balanceCents: number;
  availableBalanceCents: number;
  reserveCents: number;
  currency: string;
}

interface PropertyBalanceRow extends OwnerBalanceRow {
  propertyName: string | null;
  ownerKey: string;
  ownerLabel: string;
}

function escapeCsvField(value: string): string {
  if (/[";\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function DueToOwnerTable({ properties }: { properties: PropertyOption[] }) {
  const [date, setDate] = useState(todayIso());
  const [balances, setBalances] = useState<OwnerBalanceRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hideZero, setHideZero] = useState(true);
  const [search, setSearch] = useState("");
  const [expandedOwners, setExpandedOwners] = useState<Set<string>>(new Set());

  function toggleOwner(ownerKey: string) {
    setExpandedOwners((prev) => {
      const next = new Set(prev);
      if (next.has(ownerKey)) next.delete(ownerKey);
      else next.add(ownerKey);
      return next;
    });
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/finance/owner-balances?date=${date}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setBalances(null);
      } else {
        setBalances(data.balances);
        setExpandedOwners(new Set());
      }
    } catch {
      setError("Impossible de charger les soldes propriétaires.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Un bien peut regrouper plusieurs listings VRPlatform (références
  // supplémentaires, ex: "14ECO 1" rattaché au bien "14ECO") — tous
  // partagent le même propriétaire que le bien principal, d'où l'indexation
  // sur la référence principale ET chaque référence supplémentaire.
  const propertyByReference = useMemo(() => {
    const map = new Map<string, PropertyOption>();
    for (const p of properties) {
      map.set(p.reference.trim().toLowerCase(), p);
      for (const ref of p.extraVrplatformReferences) map.set(ref.trim().toLowerCase(), p);
    }
    return map;
  }, [properties]);

  const rows: PropertyBalanceRow[] = useMemo(() => {
    if (!balances) return [];
    return balances.map((b): PropertyBalanceRow => {
      const property = propertyByReference.get(b.reference.trim().toLowerCase());
      const ownerLabel =
        property && (property.ownerFirstName || property.ownerLastName)
          ? `${property.ownerFirstName ?? ""} ${property.ownerLastName ?? ""}`.trim()
          : (property?.ownerEmail ?? "Propriétaire inconnu");
      const ownerKey = property?.ownerEmail ?? ownerLabel;
      return {
        ...b,
        propertyName: property?.name ?? null,
        ownerKey,
        ownerLabel,
      };
    });
  }, [balances, propertyByReference]);

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows
      .filter((r) => !hideZero || r.balanceCents !== 0)
      .filter((r) => {
        if (!needle) return true;
        return r.reference.toLowerCase().includes(needle) || r.ownerLabel.toLowerCase().includes(needle);
      });
  }, [rows, hideZero, search]);

  const groupsByOwner = useMemo(() => {
    const byOwner = new Map<string, { ownerLabel: string; rows: PropertyBalanceRow[] }>();
    for (const row of filteredRows) {
      const group = byOwner.get(row.ownerKey) ?? { ownerLabel: row.ownerLabel, rows: [] };
      group.rows.push(row);
      byOwner.set(row.ownerKey, group);
    }
    return Array.from(byOwner.entries())
      .map(([ownerKey, group]) => ({
        ownerKey,
        ownerLabel: group.ownerLabel,
        rows: [...group.rows].sort((a, b) => a.reference.localeCompare(b.reference, "fr")),
        totalCents: group.rows.reduce((sum, r) => sum + r.balanceCents, 0),
      }))
      .sort((a, b) => b.totalCents - a.totalCents);
  }, [filteredRows]);

  const grandTotalCents = filteredRows.reduce((sum, r) => sum + r.balanceCents, 0);

  function exportExcel() {
    if (filteredRows.length === 0) return;
    const header = ["Propriétaire", "Bien", "Solde dû", "Réserve", "Disponible", "Devise"];
    const lines: string[][] = [header];
    for (const group of groupsByOwner) {
      for (const row of group.rows) {
        lines.push([
          group.ownerLabel,
          row.reference,
          formatEuros(row.balanceCents / 100),
          formatEuros(row.reserveCents / 100),
          formatEuros(row.availableBalanceCents / 100),
          row.currency.toUpperCase(),
        ]);
      }
    }
    lines.push(["", "Total", formatEuros(grandTotalCents / 100), "", "", ""]);
    const content = lines.map((line) => line.map(escapeCsvField).join(";")).join("\n");
    const blob = new Blob(["﻿" + content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `due_to_owner_${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-[8px] border border-black/10 px-2 py-1.5 text-[13px]"
        />
        <button type="button" onClick={load} disabled={loading} className="btn-secondary btn-sm">
          {loading ? "Chargement…" : "Charger"}
        </button>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un bien ou un propriétaire…"
          className="rounded-[8px] border border-black/10 px-2 py-1.5 text-[13px]"
        />
        <label className="flex items-center gap-1.5 text-[12px] text-[#6e6e73]">
          <input type="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} />
          Masquer les soldes à zéro
        </label>
        {balances && (
          <span className="text-[12px] text-[#6e6e73]">
            {filteredRows.length} bien{filteredRows.length > 1 ? "s" : ""} — total {formatEuros(grandTotalCents / 100)}
          </span>
        )}
        <button
          type="button"
          onClick={exportExcel}
          disabled={filteredRows.length === 0}
          className="btn-secondary btn-sm ml-auto"
        >
          Exporter Excel (CSV)
        </button>
      </div>

      <p className="text-[12px] text-[#6e6e73]">
        Solde comptable VRPlatform dû à chaque propriétaire à la date choisie (inclut les écritures pas encore sur
        un relevé publié) — positif = montant à verser au propriétaire.
      </p>

      {error && <p className="text-[13px] text-red-600">{error}</p>}

      {balances && filteredRows.length === 0 && !loading && !error && (
        <p className="text-[13px] text-[#6e6e73]">Aucun solde pour ce filtre.</p>
      )}

      {filteredRows.length > 0 && (
        <div className="overflow-hidden rounded-[14px] border border-black/[0.06]">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-black/[0.08] bg-black/[0.015]">
                  <th className="py-1.5 pl-3 pr-2 text-left text-[11px] font-medium text-[#86868b]">Bien</th>
                  <th className="py-1.5 px-2 text-right text-[11px] font-medium text-[#86868b]">Réserve</th>
                  <th className="py-1.5 px-2 text-right text-[11px] font-medium text-[#86868b]">Disponible</th>
                  <th className="py-1.5 pl-2 pr-3 text-right text-[11px] font-medium text-[#86868b]">Solde dû</th>
                </tr>
              </thead>
              <tbody>
                {groupsByOwner.map((group) => {
                  const expanded = expandedOwners.has(group.ownerKey);
                  return (
                    <Fragment key={group.ownerKey}>
                      <tr
                        className="cursor-pointer border-b border-black/[0.08] bg-[#eef3fb] hover:bg-[#dceafb]"
                        onClick={() => toggleOwner(group.ownerKey)}
                      >
                        <td colSpan={3} className="py-1.5 pl-3 pr-2 font-semibold text-[#1d1d1f]">
                          {expanded ? "▾" : "▸"} {group.ownerLabel} ({group.rows.length})
                        </td>
                        <td className="py-1.5 pl-2 pr-3 text-right font-semibold tabular-nums text-[#1d1d1f]">
                          {formatEuros(group.totalCents / 100)}
                        </td>
                      </tr>
                      {expanded &&
                        group.rows.map((row, rowIndex) => (
                          <tr
                            key={row.listingId}
                            className={`border-b border-black/[0.04] transition-colors last:border-b-0 hover:bg-[#dceafb] ${
                              rowIndex % 2 === 0 ? "bg-white" : "bg-[#f0f6fd]"
                            }`}
                          >
                            <td className="py-1.5 pl-3 pr-2 font-medium text-[#1d1d1f]">
                              {row.reference}
                              {row.propertyName && <div className="text-[10.5px] text-[#86868b]">{row.propertyName}</div>}
                            </td>
                            <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">
                              {formatEuros(row.reserveCents / 100)}
                            </td>
                            <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">
                              {formatEuros(row.availableBalanceCents / 100)}
                            </td>
                            <td className="py-1.5 pl-2 pr-3 text-right tabular-nums font-semibold text-[#1d1d1f]">
                              {formatEuros(row.balanceCents / 100)}
                            </td>
                          </tr>
                        ))}
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
