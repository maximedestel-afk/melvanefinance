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

function escapeCsvField(value: string): string {
  if (/[";\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Montant au format comptable pour le relevé PDF — négatif entre
 * parenthèses (ex: "(25,00€)") plutôt qu'avec un signe moins. */
function formatEurosAccounting(cents: number): string {
  const euros = cents / 100;
  return euros < 0 ? `(${formatEuros(-euros)})` : formatEuros(euros);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function SupplierExpensesTable() {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => currentYear - 4 + i);

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

  /** Export "lisible Excel" (point-virgule, pas le format d'import
   * VRPlatform) — une ligne par ligne de facture, groupée par catégorie
   * comme à l'écran. */
  function exportExcel() {
    if (!expenses || expenses.length === 0) return;
    const header = ["Catégorie", "Bien", "Date", "Description", "Réf. paiement", "Statut", "Montant"];
    const rows: string[][] = [header];
    for (const group of groupsByAccount) {
      for (const line of group.lines) {
        rows.push([
          group.accountName,
          line.listingRef ?? "",
          formatDate(line.date),
          line.description,
          line.paymentReference ?? line.shortRef ?? "",
          STATUS_LABELS[line.paidStatus],
          formatEuros(line.cents / 100),
        ]);
      }
    }
    rows.push(["", "", "", "", "", "Total", formatEuros(total / 100)]);
    const csvContent = rows.map((r) => r.map(escapeCsvField).join(";")).join("\r\n");
    const blob = new Blob(["﻿" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `supplier_expenses_${todayIso()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Relevé fournisseur imprimable (même structure que le modèle de devis
   * Melvane : en-tête société, bloc infos, tableau, total), ouvert dans un
   * nouvel onglet avec le dialogue d'impression du navigateur déjà lancé —
   * l'utilisateur choisit "Enregistrer en PDF" pour obtenir le fichier. Pas
   * de TVA : les montants sont déjà des dépenses dues, pas une vente. */
  function exportStatementPdf() {
    if (!expenses || expenses.length === 0) return;
    const vendor = (vendors ?? []).find((v) => v.id === vendorId);
    const vendorLabel = vendor?.name ?? vendor?.email ?? "—";
    const periodLabel =
      mode === "month" ? `${MONTH_LABELS_SHORT[month - 1]} ${year}` : `${formatDate(startDate)} — ${formatDate(endDate)}`;
    const refSuffix = mode === "month" ? `${year}${String(month).padStart(2, "0")}` : startDate.replace(/-/g, "");
    const reference = `REL-${refSuffix}-01`;
    const issueDate = formatDate(todayIso());

    const statusClass: Record<VendorExpenseLine["paidStatus"], string> = {
      paid: "status-paid",
      unpaid: "status-unpaid",
      underpaid: "status-partial",
      overpaid: "status-partial",
    };

    const rowsHtml = groupsByAccount
      .map(
        (group) => `
            <tr class="category">
              <td colspan="4">${escapeHtml(group.accountName)} <span class="muted">(${group.lines.length})</span></td>
              <td class="num nowrap">${escapeHtml(formatEurosAccounting(group.totalCents))}</td>
            </tr>` +
          group.lines
            .map(
              (line) => `
            <tr>
              <td>${escapeHtml(line.description)}</td>
              <td>${escapeHtml(line.listingRef ?? "—")}</td>
              <td class="num nowrap">${formatDate(line.date)}</td>
              <td class="nowrap ${statusClass[line.paidStatus]}">${escapeHtml(STATUS_LABELS[line.paidStatus])}</td>
              <td class="num">${escapeHtml(formatEurosAccounting(line.cents))}</td>
            </tr>`
            )
            .join("")
      )
      .join("");

    // Détail des paiements sous le total — par statut présent dans les
    // lignes exportées, puis solde dû (total moins ce qui est réglé : payé
    // + payé en trop, qui compte comme réglé même si le montant diffère).
    const paidCents = expenses.filter((e) => e.paidStatus === "paid").reduce((s, e) => s + e.cents, 0);
    const overpaidCents = expenses.filter((e) => e.paidStatus === "overpaid").reduce((s, e) => s + e.cents, 0);
    const underpaidCents = expenses.filter((e) => e.paidStatus === "underpaid").reduce((s, e) => s + e.cents, 0);
    const unpaidCents = expenses.filter((e) => e.paidStatus === "unpaid").reduce((s, e) => s + e.cents, 0);
    const balanceDueCents = total - paidCents - overpaidCents;
    const paymentBreakdown: { label: string; cents: number }[] = [
      { label: "Payé", cents: paidCents },
      { label: "Payé en trop", cents: overpaidCents },
      { label: "Payé partiellement", cents: underpaidCents },
      { label: "Non payé", cents: unpaidCents },
    ].filter((row) => row.cents !== 0);
    const paymentsHtml = paymentBreakdown
      .map(
        (row) => `
          <div class="line small"><span>${escapeHtml(row.label)}</span><span>${escapeHtml(formatEurosAccounting(row.cents))}</span></div>`
      )
      .join("");

    const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>Relevé fournisseur — ${escapeHtml(vendorLabel)}</title>
<style>
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    color: #1d1d1f;
    margin: 0;
    padding: 48px 56px;
  }
  .header { display: flex; justify-content: space-between; align-items: flex-start; }
  .mark {
    width: 40px; height: 40px; border-radius: 10px; background: #1d1d1f;
    display: flex; align-items: center; justify-content: center;
  }
  .mark svg { width: 20px; height: 20px; fill: #fff; }
  .company { text-align: right; font-size: 12px; color: #6e6e73; line-height: 1.5; }
  .company strong { color: #1d1d1f; font-size: 13px; }
  h1 { font-size: 40px; font-weight: 700; margin: 40px 0 4px; }
  .subtitle { color: #6e6e73; font-size: 14px; margin: 0 0 24px; }
  .infobox {
    display: flex; gap: 32px; background: #f5f5f7; border-radius: 12px;
    padding: 16px 20px; margin-bottom: 28px;
  }
  .infobox div { flex: 1; }
  .infobox .label { font-size: 10px; letter-spacing: 0.04em; color: #86868b; text-transform: uppercase; }
  .infobox .value { font-size: 14px; font-weight: 600; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  thead th {
    text-align: left; font-size: 10px; letter-spacing: 0.04em; color: #86868b;
    text-transform: uppercase; padding: 0 12px 8px 0; border-bottom: 1px solid #e5e5ea;
  }
  thead th.num, td.num { text-align: right; }
  td.nowrap, th.num { white-space: nowrap; }
  tbody td { padding: 10px 12px 10px 0; border-bottom: 1px solid #f0f0f2; font-size: 13px; vertical-align: top; }
  tr.category td { background: rgba(0, 113, 227, 0.1); font-weight: 600; padding: 7px 10px; border-bottom: 1px solid #e5e5ea; }
  tr.category td:first-child { border-top-left-radius: 8px; border-bottom-left-radius: 8px; }
  tr.category td:last-child { border-top-right-radius: 8px; border-bottom-right-radius: 8px; }
  tbody tr:not(.category) td:first-child, tbody tr:not(.category) td:nth-child(2) { padding-left: 10px; }
  .muted { color: #86868b; font-size: 12px; }
  .status-paid { color: #15803d; font-weight: 600; }
  .status-unpaid { color: #b45309; font-weight: 600; }
  .status-partial { color: #6e6e73; font-weight: 600; }
  .line {
    display: flex; justify-content: space-between; gap: 40px;
    padding: 10px 0; font-size: 18px; font-weight: 700; border-top: 2px solid #1d1d1f;
  }
  .line.small {
    font-size: 13px; font-weight: 500; color: #6e6e73; border-top: none; padding: 4px 0;
  }
  .line.balance {
    font-size: 16px; font-weight: 700; border-top: 1px solid #e5e5ea; margin-top: 4px; padding-top: 10px;
  }
  .totals { margin-top: 20px; display: flex; justify-content: flex-end; }
  .totals .line { width: 260px; }
  .payments { margin-top: 10px; display: flex; justify-content: flex-end; }
  .payments .block { width: 260px; }
  .footnote { margin-top: 48px; font-size: 11px; color: #86868b; line-height: 1.5; }
  @media print {
    body { padding: 0 32px; }
    @page { margin: 24px; }
  }
</style>
</head>
<body>
  <div class="header">
    <div class="mark"><svg viewBox="0 0 24 24"><path d="M12 3 2 12h3v8h5v-6h4v6h5v-8h3z"/></svg></div>
    <div class="company">
      <strong>Melvane by Design</strong><br />
      20-22 Wenlock Road<br />
      London N1 7GU, Royaume-Uni<br />
      melvanebydesign@gmail.com
    </div>
  </div>

  <h1>Relevé fournisseur</h1>
  <p class="subtitle">Récapitulatif des sommes dues</p>

  <div class="infobox">
    <div><div class="label">Fournisseur</div><div class="value">${escapeHtml(vendorLabel)}</div></div>
    <div><div class="label">Période</div><div class="value">${escapeHtml(periodLabel)}</div></div>
    <div><div class="label">Référence</div><div class="value">${escapeHtml(reference)}</div></div>
    <div><div class="label">Date</div><div class="value">${escapeHtml(issueDate)}</div></div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Désignation</th>
        <th>Bien</th>
        <th class="num">Date</th>
        <th>Statut</th>
        <th class="num">Montant</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>

  <div class="totals">
    <div class="line"><span>Total</span><span>${escapeHtml(formatEurosAccounting(total))}</span></div>
  </div>

  ${
    paymentBreakdown.length > 0
      ? `<div class="payments">
    <div class="block">
      ${paymentsHtml}
      <div class="line balance"><span>Solde dû</span><span>${escapeHtml(formatEurosAccounting(balanceDueCents))}</span></div>
    </div>
  </div>`
      : ""
  }

  <p class="footnote">
    Relevé généré le ${issueDate} — ${expenses.length} ligne${expenses.length !== 1 ? "s" : ""}.
  </p>
</body>
</html>`;

    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.onload = () => printWindow.print();
  }

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
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[#0071e3]/10 px-3 py-1.5 text-[13px] font-semibold text-[#0071e3]">
              {expenses.length} ligne{expenses.length !== 1 ? "s" : ""} sur {groupsByAccount.length} catégorie
              {groupsByAccount.length !== 1 ? "s" : ""} · {formatEuros(total / 100)}
            </span>
            <button type="button" onClick={exportStatementPdf} className="btn-secondary btn-sm ml-auto">
              Relevé fournisseur (PDF)
            </button>
            <button type="button" onClick={exportExcel} className="btn-secondary btn-sm">
              Exporter Excel (CSV)
            </button>
          </div>
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
