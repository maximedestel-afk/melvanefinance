"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { formatEuros, todayIso } from "@/lib/format";

interface PropertyOption {
  id: string;
  reference: string;
  name: string | null;
  extraVrplatformReferences: string[];
  rentAmount: number | null;
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

interface OwnerBalanceActivity {
  listingId: string;
  netOwnerRevenueCents: number;
  payoutCents: number;
  expenseCents: number;
}

interface PropertyBalanceRow {
  listingId: string;
  reference: string;
  propertyName: string | null;
  ownerKey: string;
  ownerLabel: string;
  prevMonthCents: number;
  currentCents: number;
  netOwnerRevenueCents: number;
  payoutCents: number;
  expenseCents: number;
  rentCents: number;
  totalCents: number;
}

function escapeCsvField(value: string): string {
  if (/[";\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Dernier jour du mois précédant celui de `dateIso`. */
function endOfPreviousMonth(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  const firstOfMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const endOfPrev = new Date(firstOfMonth.getTime() - 24 * 60 * 60 * 1000);
  return endOfPrev.toISOString().slice(0, 10);
}

function formatShortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", timeZone: "UTC" });
}

export function DueToOwnerTable({ properties }: { properties: PropertyOption[] }) {
  const [date, setDate] = useState(todayIso());
  const [balancesPrevMonth, setBalancesPrevMonth] = useState<OwnerBalanceRow[] | null>(null);
  const [balancesCurrent, setBalancesCurrent] = useState<OwnerBalanceRow[] | null>(null);
  const [activity, setActivity] = useState<OwnerBalanceActivity[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hideZero, setHideZero] = useState(false);
  const [search, setSearch] = useState("");
  const [expandedOwners, setExpandedOwners] = useState<Set<string>>(new Set());

  const prevMonthDate = endOfPreviousMonth(date);
  const monthStartDate = `${date.slice(0, 7)}-01`;

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
      const [prevRes, currentRes] = await Promise.all([
        fetch(`/api/finance/owner-balances?date=${prevMonthDate}`),
        fetch(`/api/finance/owner-balances?date=${date}&activityStartDate=${monthStartDate}`),
      ]);
      const prevData = await prevRes.json();
      const currentData = await currentRes.json();
      if (prevData.error || currentData.error) {
        setError(prevData.error || currentData.error);
        setBalancesPrevMonth(null);
        setBalancesCurrent(null);
        setActivity(null);
      } else {
        setBalancesPrevMonth(prevData.balances);
        setBalancesCurrent(currentData.balances);
        setActivity(currentData.activity);
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
    if (!balancesPrevMonth || !balancesCurrent) return [];
    const prevByListing = new Map(balancesPrevMonth.map((b) => [b.listingId, b]));
    const currentByListing = new Map(balancesCurrent.map((b) => [b.listingId, b]));
    const activityByListing = new Map((activity ?? []).map((a) => [a.listingId, a]));
    const listingIds = new Set([...prevByListing.keys(), ...currentByListing.keys()]);

    const result: PropertyBalanceRow[] = [];
    for (const listingId of listingIds) {
      const prev = prevByListing.get(listingId);
      const current = currentByListing.get(listingId);
      const listingActivity = activityByListing.get(listingId);
      const reference = current?.reference ?? prev?.reference ?? "?";
      const property = propertyByReference.get(reference.trim().toLowerCase());
      // Exclut les listings qu'on ne sait rattacher à aucun propriétaire connu
      // localement — demandé explicitement pour ne pas polluer la liste.
      if (!property) continue;

      const ownerLabel =
        property.ownerFirstName || property.ownerLastName
          ? `${property.ownerFirstName ?? ""} ${property.ownerLastName ?? ""}`.trim()
          : (property.ownerEmail ?? "Propriétaire inconnu");
      const ownerKey = property.ownerEmail ?? ownerLabel;

      // Le loyer n'est compté qu'une fois par bien (sur le listing
      // principal) pour ne pas être doublé quand une référence VRPlatform
      // supplémentaire (ex: "14ECO 1") est rattachée au même bien.
      const isMainListing = property.reference.trim().toLowerCase() === reference.trim().toLowerCase();
      const rentCents = isMainListing && property.rentAmount != null ? Math.round(property.rentAmount * 100) : 0;
      const prevMonthCents = prev?.balanceCents ?? 0;
      const currentCents = current?.balanceCents ?? 0;
      const expenseCents = listingActivity?.expenseCents ?? 0;
      const payoutCents = listingActivity?.payoutCents ?? 0;
      // Revenus net propriétaire = valeur dérivée, pas une somme d'écritures
      // classées : solde à la date choisie moins les dépenses du mois moins
      // les payouts du mois moins le solde du mois précédent (demandé
      // explicitement — la classification par entityType ne tombait pas
      // juste).
      const netOwnerRevenueCents = currentCents - expenseCents - payoutCents - prevMonthCents;

      result.push({
        listingId,
        reference,
        propertyName: property.name,
        ownerKey,
        ownerLabel,
        prevMonthCents,
        currentCents,
        netOwnerRevenueCents,
        payoutCents,
        expenseCents,
        rentCents,
        totalCents: prevMonthCents + currentCents + rentCents,
      });
    }
    return result;
  }, [balancesPrevMonth, balancesCurrent, activity, propertyByReference]);

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows
      .filter((r) => !hideZero || r.totalCents !== 0)
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
        prevMonthCents: group.rows.reduce((sum, r) => sum + r.prevMonthCents, 0),
        currentCents: group.rows.reduce((sum, r) => sum + r.currentCents, 0),
        netOwnerRevenueCents: group.rows.reduce((sum, r) => sum + r.netOwnerRevenueCents, 0),
        payoutCents: group.rows.reduce((sum, r) => sum + r.payoutCents, 0),
        expenseCents: group.rows.reduce((sum, r) => sum + r.expenseCents, 0),
        rentCents: group.rows.reduce((sum, r) => sum + r.rentCents, 0),
        totalCents: group.rows.reduce((sum, r) => sum + r.totalCents, 0),
      }))
      .sort((a, b) => b.totalCents - a.totalCents);
  }, [filteredRows]);

  const grandTotalCents = filteredRows.reduce((sum, r) => sum + r.totalCents, 0);
  const loaded = balancesPrevMonth != null && balancesCurrent != null;

  function exportExcel() {
    if (filteredRows.length === 0) return;
    const header = [
      "Propriétaire",
      "Bien",
      `Solde au ${prevMonthDate}`,
      "Revenus net propriétaire",
      "Payouts",
      `Solde au ${date}`,
      "Dépenses",
      "Loyer",
      "Total",
    ];
    const lines: string[][] = [header];
    for (const group of groupsByOwner) {
      for (const row of group.rows) {
        lines.push([
          group.ownerLabel,
          row.reference,
          formatEuros(row.prevMonthCents / 100),
          formatEuros(row.netOwnerRevenueCents / 100),
          formatEuros(row.payoutCents / 100),
          formatEuros(row.currentCents / 100),
          formatEuros(row.expenseCents / 100),
          formatEuros(row.rentCents / 100),
          formatEuros(row.totalCents / 100),
        ]);
      }
    }
    lines.push(["", "Total", "", "", "", "", "", "", formatEuros(grandTotalCents / 100)]);
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
        <label className="flex items-center gap-1.5 text-[12px] text-[#6e6e73]">
          Date (mois en cours)
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-[8px] border border-black/10 px-2 py-1.5 text-[13px]"
          />
        </label>
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
          Masquer les totaux à zéro
        </label>
        {loaded && (
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
        Soldes comptables VRPlatform (positif = montant dû au propriétaire), fin du mois précédent ({formatShortDate(prevMonthDate)})
        et à la date choisie, plus le loyer du bien — biens non rattachés à un propriétaire connu exclus. Revenus net
        propriétaire, Payouts et Dépenses détaillent l&apos;activité du mois en cours (depuis le {formatShortDate(monthStartDate)}),
        à titre indicatif — Revenus net propriétaire = Solde à la date choisie − Dépenses − Payouts − Solde du mois précédent.
      </p>

      {error && <p className="text-[13px] text-red-600">{error}</p>}

      {loaded && filteredRows.length === 0 && !loading && !error && (
        <p className="text-[13px] text-[#6e6e73]">Aucun solde pour ce filtre.</p>
      )}

      {filteredRows.length > 0 && (
        <div className="overflow-hidden rounded-[14px] border border-black/[0.06]">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-black/[0.08] bg-black/[0.015]">
                  <th className="py-1.5 pl-3 pr-2 text-left text-[11px] font-medium text-[#86868b]">Bien</th>
                  <th className="py-1.5 px-2 text-right text-[11px] font-medium text-[#86868b]">
                    Solde au {formatShortDate(prevMonthDate)}
                  </th>
                  <th className="py-1.5 px-2 text-right text-[11px] font-medium text-[#86868b]">
                    Revenus net propriétaire
                  </th>
                  <th className="py-1.5 px-2 text-right text-[11px] font-medium text-[#86868b]">Payouts</th>
                  <th className="py-1.5 px-2 text-right text-[11px] font-medium text-[#86868b]">
                    Solde au {formatShortDate(date)}
                  </th>
                  <th className="py-1.5 px-2 text-right text-[11px] font-medium text-[#86868b]">Dépenses</th>
                  <th className="py-1.5 px-2 text-right text-[11px] font-medium text-[#86868b]">Loyer</th>
                  <th className="py-1.5 pl-2 pr-3 text-right text-[11px] font-medium text-[#86868b]">Total</th>
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
                        <td className="py-1.5 pl-3 pr-2 font-semibold text-[#1d1d1f]">
                          {expanded ? "▾" : "▸"} {group.ownerLabel} ({group.rows.length})
                        </td>
                        <td className="py-1.5 px-2 text-right font-semibold tabular-nums text-[#1d1d1f]">
                          {formatEuros(group.prevMonthCents / 100)}
                        </td>
                        <td className="py-1.5 px-2 text-right font-semibold tabular-nums text-[#1d1d1f]">
                          {formatEuros(group.netOwnerRevenueCents / 100)}
                        </td>
                        <td className="py-1.5 px-2 text-right font-semibold tabular-nums text-[#1d1d1f]">
                          {formatEuros(group.payoutCents / 100)}
                        </td>
                        <td className="py-1.5 px-2 text-right font-semibold tabular-nums text-[#1d1d1f]">
                          {formatEuros(group.currentCents / 100)}
                        </td>
                        <td className="py-1.5 px-2 text-right font-semibold tabular-nums text-[#1d1d1f]">
                          {formatEuros(group.expenseCents / 100)}
                        </td>
                        <td className="py-1.5 px-2 text-right font-semibold tabular-nums text-[#1d1d1f]">
                          {formatEuros(group.rentCents / 100)}
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
                              {formatEuros(row.prevMonthCents / 100)}
                            </td>
                            <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">
                              {formatEuros(row.netOwnerRevenueCents / 100)}
                            </td>
                            <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">
                              {formatEuros(row.payoutCents / 100)}
                            </td>
                            <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">
                              {formatEuros(row.currentCents / 100)}
                            </td>
                            <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">
                              {formatEuros(row.expenseCents / 100)}
                            </td>
                            <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">
                              {formatEuros(row.rentCents / 100)}
                            </td>
                            <td className="py-1.5 pl-2 pr-3 text-right tabular-nums font-semibold text-[#1d1d1f]">
                              {formatEuros(row.totalCents / 100)}
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
