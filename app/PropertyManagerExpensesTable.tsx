"use client";

import { Fragment, useMemo, useState } from "react";
import { formatEuros, MONTH_LABELS_SHORT } from "@/lib/format";
import type { ManagerExpenseEntry } from "@/lib/vrplatform";

function Money({ cents, bold = false }: { cents: number; bold?: boolean }) {
  return <span className={bold ? "font-semibold" : undefined}>{formatEuros(cents / 100)}</span>;
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export function PropertyManagerExpensesTable() {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 4 + i);

  const [year, setYear] = useState(currentYear);
  const [selectedMonths, setSelectedMonths] = useState<number[]>([new Date().getMonth() + 1]);
  const [showPeriodPicker, setShowPeriodPicker] = useState(false);
  const [rows, setRows] = useState<ManagerExpenseEntry[] | null>(null);
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

  function toggleMonth(month: number) {
    setSelectedMonths((prev) =>
      prev.includes(month) ? prev.filter((m) => m !== month) : [...prev, month].sort((a, b) => a - b)
    );
  }

  async function load() {
    if (selectedMonths.length === 0) {
      setError("Sélectionne au moins un mois.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ year: String(year), months: selectedMonths.join(",") });
      const res = await fetch(`/api/finance/manager-expenses?${params.toString()}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setRows(null);
      } else {
        setRows(data.rows);
        setExpandedAccounts(new Set());
      }
    } catch {
      setError("Impossible de charger les dépenses.");
    } finally {
      setLoading(false);
    }
  }

  const totalCents = rows ? rows.reduce((sum, r) => sum + r.cents, 0) : 0;

  const groupsByAccount = useMemo(() => {
    if (!rows) return [];
    const byAccount = new Map<string, ManagerExpenseEntry[]>();
    for (const row of rows) {
      const list = byAccount.get(row.accountName) ?? [];
      list.push(row);
      byAccount.set(row.accountName, list);
    }
    return Array.from(byAccount.entries())
      .map(([accountName, entries]) => ({
        accountName,
        entries: [...entries].sort((a, b) => a.date.localeCompare(b.date)),
        totalCents: entries.reduce((sum, e) => sum + e.cents, 0),
      }))
      .sort((a, b) => Math.abs(b.totalCents) - Math.abs(a.totalCents));
  }, [rows]);

  const periodSummary =
    selectedMonths.length === 0
      ? "Aucun mois"
      : selectedMonths.length === 12
        ? `Année complète ${year}`
        : `${selectedMonths.map((m) => MONTH_LABELS_SHORT[m - 1]).join(", ")} ${year}`;

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-[#6e6e73]">
        Écritures des comptes de dépense VRPlatform postées côté manager (M.G.B.) plutôt que côté propriétaire —
        contrepartie des frais récurrents (Transfer Fees, partage de commission VRBO...) sur le mois choisi.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowPeriodPicker((v) => !v)}
            className="flex items-center gap-2 rounded-[10px] border-2 border-[#0071e3] bg-white px-3 py-2 text-[13px] font-medium text-[#0071e3] transition hover:bg-[#0071e3]/5"
          >
            📅 {periodSummary}
            <span aria-hidden className={`transition-transform ${showPeriodPicker ? "rotate-180" : ""}`}>
              ▾
            </span>
          </button>
          {showPeriodPicker && (
            <div className="absolute left-0 top-full z-10 mt-1.5 w-max rounded-[12px] border border-black/10 bg-white p-3.5 shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
              <div>
                <label className="field-label" htmlFor="manager-expenses-year">
                  Année
                </label>
                <select
                  id="manager-expenses-year"
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

              <div className="mt-3">
                <span className="field-label">Mois</span>
                <div className="mt-1 flex flex-wrap gap-1 max-w-[280px]">
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

              <button
                type="button"
                onClick={() => setShowPeriodPicker(false)}
                className="mt-3 w-full rounded-[8px] bg-[#0071e3] px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-[#0071e3]/90"
              >
                Valider
              </button>
            </div>
          )}
        </div>

        <button type="button" onClick={load} disabled={loading} className="btn-secondary btn-sm">
          {loading ? "Chargement…" : rows ? "Actualiser" : "Charger"}
        </button>
      </div>

      {error && <p className="text-[13px] text-red-600">{error}</p>}

      {rows && rows.length === 0 && !loading && !error && (
        <p className="text-[13px] text-[#6e6e73]">Aucune dépense côté manager sur cette période.</p>
      )}

      {rows && rows.length > 0 && !loading && !error && (
        <div className="overflow-hidden rounded-[14px] border border-black/[0.06]">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-black/[0.08] bg-black/[0.015]">
                  <th className="py-1.5 pl-3 pr-2 text-left text-[11px] font-medium text-[#86868b]">Compte</th>
                  <th className="py-1.5 px-2 text-left text-[11px] font-medium text-[#86868b]">Bien</th>
                  <th className="py-1.5 px-2 text-left text-[11px] font-medium text-[#86868b]">Date</th>
                  <th className="py-1.5 px-2 text-left text-[11px] font-medium text-[#86868b]">Description</th>
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
                          <span aria-hidden className={`mr-1.5 inline-block transition-transform ${expanded ? "rotate-90" : ""}`}>
                            ▸
                          </span>
                          {group.accountName}
                        </td>
                        <td className="py-1.5 px-2 text-[#6e6e73]">
                          {group.entries.length} écriture{group.entries.length !== 1 ? "s" : ""}
                        </td>
                        <td className="py-1.5 px-2"></td>
                        <td className="py-1.5 px-2"></td>
                        <td className="py-1.5 pl-2 pr-3 text-right tabular-nums font-semibold text-[#1d1d1f]">
                          <Money cents={group.totalCents} bold />
                        </td>
                      </tr>
                      {expanded &&
                        group.entries.map((row, rowIndex) => (
                          <tr
                            key={`${row.reference ?? "none"}-${row.date}-${rowIndex}`}
                            className={`border-b border-black/[0.04] last:border-b-0 ${
                              rowIndex % 2 === 0 ? "bg-white" : "bg-[#f0f6fd]"
                            }`}
                          >
                            <td className="py-1.5 pl-3 pr-2"></td>
                            <td className="py-1.5 px-2 font-medium text-[#1d1d1f]">
                              {row.reference || <span className="text-[#6e6e73]">—</span>}
                            </td>
                            <td className="py-1.5 px-2 text-[#1d1d1f]">{formatDate(row.date)}</td>
                            <td className="py-1.5 px-2 text-[#1d1d1f]">
                              {row.description || <span className="text-[#6e6e73]">—</span>}
                            </td>
                            <td className="py-1.5 pl-2 pr-3 text-right tabular-nums text-[#1d1d1f]">
                              <Money cents={row.cents} />
                            </td>
                          </tr>
                        ))}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-black/[0.08] bg-black/[0.015] font-semibold text-[#1d1d1f]">
                  <td className="py-1.5 pl-3 pr-2" colSpan={4}>
                    Total ({rows.length} écriture{rows.length !== 1 ? "s" : ""} sur {groupsByAccount.length} compte
                    {groupsByAccount.length !== 1 ? "s" : ""})
                  </td>
                  <td className="py-1.5 pl-2 pr-3 text-right tabular-nums">
                    <Money cents={totalCents} bold />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {!rows && !loading && !error && (
        <p className="text-[13px] text-[#6e6e73]">Choisis une année et un ou plusieurs mois, puis charge les données.</p>
      )}
    </div>
  );
}
