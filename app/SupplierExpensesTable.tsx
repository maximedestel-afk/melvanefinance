"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { formatEuros, MONTH_LABELS_SHORT, todayIso } from "@/lib/format";

interface VendorContact {
  id: string;
  name: string | null;
  email: string | null;
}

interface VendorExpenseLine {
  transactionId: string;
  date: string;
  description: string;
  listingRef: string | null;
  accountName: string;
  cents: number;
  paidStatus: "unpaid" | "underpaid" | "overpaid" | "paid";
  shortRef: string | null;
  paymentReference: string | null;
}

type StatusFilter = "unpaid" | "paid" | "both";
type Mode = "month" | "range";

const STATUS_LABELS: Record<VendorExpenseLine["paidStatus"], string> = {
  unpaid: "Non payé",
  underpaid: "Payé partiellement",
  overpaid: "Payé en trop",
  paid: "Payé",
};

function formatDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export function SupplierExpensesTable() {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 4 + i);

  const [vendors, setVendors] = useState<VendorContact[] | null>(null);
  const [vendorsError, setVendorsError] = useState<string | null>(null);
  const [vendorId, setVendorId] = useState<string>("");

  const [mode, setMode] = useState<Mode>("month");
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(todayIso());

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("unpaid");

  const [expenses, setExpenses] = useState<VendorExpenseLine[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());

  function toggleAccount(accountName: string) {
    setExpandedAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(accountName)) next.delete(accountName);
      else next.add(accountName);
      return next;
    });
  }

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/finance/vendor-contacts");
        const data = await res.json();
        if (data.error) {
          setVendorsError(data.error);
        } else {
          const sorted = [...data.contacts].sort((a: VendorContact, b: VendorContact) =>
            (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? "", "fr")
          );
          setVendors(sorted);
        }
      } catch {
        setVendorsError("Impossible de charger les vendors VRPlatform.");
      }
    })();
  }, []);

  async function load() {
    if (!vendorId) {
      setError("Choisis un vendor.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ contactId: vendorId, status: statusFilter });
      if (mode === "month") {
        params.set("year", String(year));
        params.set("month", String(month));
      } else {
        params.set("startDate", startDate);
        params.set("endDate", endDate);
      }
      const res = await fetch(`/api/finance/supplier-expenses?${params.toString()}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setExpenses(null);
      } else {
        setExpenses(data.expenses);
        setExpandedAccounts(new Set());
      }
    } catch {
      setError("Impossible de charger les dépenses de ce vendor.");
    } finally {
      setLoading(false);
    }
  }

  const total = expenses ? expenses.reduce((sum, e) => sum + e.cents, 0) : 0;

  const groupsByAccount = useMemo(() => {
    if (!expenses) return [];
    const byAccount = new Map<string, VendorExpenseLine[]>();
    for (const line of expenses) {
      const list = byAccount.get(line.accountName) ?? [];
      list.push(line);
      byAccount.set(line.accountName, list);
    }
    return Array.from(byAccount.entries())
      .map(([accountName, lines]) => ({
        accountName,
        lines: [...lines].sort((a, b) => b.date.localeCompare(a.date)),
        totalCents: lines.reduce((sum, l) => sum + l.cents, 0),
      }))
      .sort((a, b) => b.totalCents - a.totalCents);
  }, [expenses]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="field-label" htmlFor="supplier-vendor">
            Vendor
          </label>
          {vendorsError ? (
            <p className="mt-1 text-[13px] text-red-600">{vendorsError}</p>
          ) : (
            <select
              id="supplier-vendor"
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
              className="mt-1 block w-64 rounded-[10px] border border-black/10 bg-white px-3 py-2 text-[14px] text-[#1d1d1f] shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus:border-[#0071e3] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
            >
              <option value="">— Choisir —</option>
              {(vendors ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name ?? v.email ?? v.id}
                  {v.name && v.email ? ` (${v.email})` : ""}
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <span className="field-label">Période</span>
          <div className="mt-1 flex overflow-hidden rounded-[10px] border border-black/10">
            <button
              type="button"
              onClick={() => setMode("month")}
              className={`px-3 py-2 text-[13px] font-medium transition ${
                mode === "month" ? "bg-[#0071e3] text-white" : "bg-white text-[#1d1d1f] hover:bg-black/[0.04]"
              }`}
            >
              Mois
            </button>
            <button
              type="button"
              onClick={() => setMode("range")}
              className={`px-3 py-2 text-[13px] font-medium transition ${
                mode === "range" ? "bg-[#0071e3] text-white" : "bg-white text-[#1d1d1f] hover:bg-black/[0.04]"
              }`}
            >
              Deux dates
            </button>
          </div>
        </div>

        {mode === "month" ? (
          <>
            <div>
              <label className="field-label" htmlFor="supplier-year">
                Année
              </label>
              <select
                id="supplier-year"
                value={year}
                onChange={(e) => setYear(Number.parseInt(e.target.value, 10))}
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
              <label className="field-label" htmlFor="supplier-month">
                Mois
              </label>
              <select
                id="supplier-month"
                value={month}
                onChange={(e) => setMonth(Number.parseInt(e.target.value, 10))}
                className="mt-1 rounded-[10px] border border-black/10 bg-white px-3 py-2 text-[14px] text-[#1d1d1f] shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus:border-[#0071e3] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
              >
                {MONTH_LABELS_SHORT.map((label, i) => (
                  <option key={label} value={i + 1}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="field-label" htmlFor="supplier-start">
                Du
              </label>
              <input
                id="supplier-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1 block rounded-[10px] border border-black/10 bg-white px-3 py-2 text-[14px] text-[#1d1d1f] focus:border-[#0071e3] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
              />
            </div>
            <div>
              <label className="field-label" htmlFor="supplier-end">
                Au
              </label>
              <input
                id="supplier-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-1 block rounded-[10px] border border-black/10 bg-white px-3 py-2 text-[14px] text-[#1d1d1f] focus:border-[#0071e3] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
              />
            </div>
          </>
        )}

        <div>
          <label className="field-label" htmlFor="supplier-status">
            Statut
          </label>
          <select
            id="supplier-status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="mt-1 rounded-[10px] border border-black/10 bg-white px-3 py-2 text-[14px] text-[#1d1d1f] shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus:border-[#0071e3] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
          >
            <option value="unpaid">Non payé</option>
            <option value="paid">Payé</option>
            <option value="both">Les deux</option>
          </select>
        </div>

        <button type="button" onClick={load} disabled={loading || !vendorId} className="btn-secondary btn-sm">
          {loading ? "Chargement…" : "Charger"}
        </button>
      </div>

      {error && <p className="text-[13px] text-red-600">{error}</p>}

      {expenses && expenses.length === 0 && !loading && !error && (
        <p className="text-[13px] text-[#6e6e73]">Aucune dépense trouvée pour ce vendor sur cette période.</p>
      )}

      {expenses && expenses.length > 0 && !loading && (
        <div className="space-y-2">
          <span className="rounded-full bg-[#0071e3]/10 px-3 py-1.5 text-[13px] font-semibold text-[#0071e3]">
            {expenses.length} ligne{expenses.length !== 1 ? "s" : ""} sur {groupsByAccount.length} catégorie
            {groupsByAccount.length !== 1 ? "s" : ""} · {formatEuros(total / 100)}
          </span>
          <div className="overflow-hidden rounded-[14px] border border-black/[0.06]">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-black/[0.08] bg-black/[0.015]">
                    <th className="py-1.5 pl-3 pr-2 text-left text-[11px] font-medium text-[#86868b]">Catégorie</th>
                    <th className="py-1.5 px-2 text-left text-[11px] font-medium text-[#86868b]">Bien</th>
                    <th className="py-1.5 px-2 text-left text-[11px] font-medium text-[#86868b]">Date</th>
                    <th className="py-1.5 px-2 text-left text-[11px] font-medium text-[#86868b]">Description</th>
                    <th className="py-1.5 px-2 text-left text-[11px] font-medium text-[#86868b]">Réf. paiement</th>
                    <th className="py-1.5 px-2 text-left text-[11px] font-medium text-[#86868b]">Statut</th>
                    <th className="py-1.5 pl-2 pr-3 text-right text-[11px] font-medium text-[#86868b]">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {groupsByAccount.map((group) => {
                    const expanded = expandedAccounts.has(group.accountName);
                    return (
                      <Fragment key={group.accountName}>
                        <tr
                          className="cursor-pointer border-b border-black/[0.04] bg-[#f5f5f7] transition hover:bg-[#ebebed]"
                          onClick={() => toggleAccount(group.accountName)}
                        >
                          <td className="py-1.5 pl-3 pr-2 font-semibold text-[#1d1d1f]">
                            <span
                              aria-hidden
                              className={`mr-1.5 inline-block transition-transform ${expanded ? "rotate-90" : ""}`}
                            >
                              ▸
                            </span>
                            {group.accountName}
                          </td>
                          <td className="py-1.5 px-2 text-[#6e6e73]" colSpan={4}>
                            {group.lines.length} ligne{group.lines.length !== 1 ? "s" : ""}
                          </td>
                          <td className="py-1.5 px-2"></td>
                          <td className="py-1.5 pl-2 pr-3 text-right tabular-nums font-semibold text-[#1d1d1f]">
                            {formatEuros(group.totalCents / 100)}
                          </td>
                        </tr>
                        {expanded &&
                          group.lines.map((line, rowIndex) => (
                            <tr
                              key={`${line.transactionId}-${line.listingRef ?? "none"}-${rowIndex}`}
                              className={`border-b border-black/[0.04] last:border-b-0 ${
                                rowIndex % 2 === 0 ? "bg-white" : "bg-[#f0f6fd]"
                              }`}
                            >
                              <td className="py-1.5 pl-3 pr-2"></td>
                              <td className="py-1.5 px-2 font-medium text-[#1d1d1f]">
                                {line.listingRef ?? <span className="text-[#6e6e73]">—</span>}
                              </td>
                              <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">
                                {formatDate(line.date)}
                              </td>
                              <td className="py-1.5 px-2 text-[#1d1d1f]">{line.description}</td>
                              <td className="py-1.5 px-2 text-[#6e6e73]">
                                {line.paymentReference ?? line.shortRef ?? "—"}
                              </td>
                              <td className="py-1.5 px-2">
                                <span
                                  className={
                                    line.paidStatus === "paid"
                                      ? "text-emerald-600"
                                      : line.paidStatus === "unpaid"
                                        ? "text-amber-600"
                                        : "text-[#6e6e73]"
                                  }
                                >
                                  {STATUS_LABELS[line.paidStatus]}
                                </span>
                              </td>
                              <td className="py-1.5 pl-2 pr-3 text-right tabular-nums text-[#1d1d1f]">
                                {formatEuros(line.cents / 100)}
                              </td>
                            </tr>
                          ))}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-black/[0.08] bg-black/[0.015] font-semibold text-[#1d1d1f]">
                    <td className="py-1.5 pl-3 pr-2" colSpan={6}>
                      Total ({expenses.length} ligne{expenses.length !== 1 ? "s" : ""} sur {groupsByAccount.length}{" "}
                      catégorie{groupsByAccount.length !== 1 ? "s" : ""})
                    </td>
                    <td className="py-1.5 pl-2 pr-3 text-right tabular-nums">{formatEuros(total / 100)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {!expenses && !loading && !error && (
        <p className="text-[13px] text-[#6e6e73]">Choisis un vendor et une période, puis charge les factures.</p>
      )}
    </div>
  );
}
