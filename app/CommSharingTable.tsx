"use client";

import { useMemo, useState } from "react";
import { formatEuros, MONTH_LABELS_SHORT } from "@/lib/format";

type SortKey = "name" | "reservationRef" | "date" | "flat" | "price" | "label" | "prestataire" | "billToOwner" | "amountDue";

interface CommSharingRow {
  id: string;
  name: string;
  reservationRef: string | null;
  date: string | null;
  flat: string | null;
  price: number | null;
  label: string | null;
  prestataire: string | null;
  billId: string | null;
  billToOwner: string | null;
}

interface PropertyOption {
  reference: string;
  bonusEciPercent: number | null;
}

// Label Monday exact pour les lignes "Early Check-in" (voir le tableau Comm
// Sharing) — seules ces lignes ont une somme due au titre du Bonus ECI.
const ECI_LABEL_PATTERN = /early check/i;

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", timeZone: "UTC" });
}

function SortHeader({
  label,
  k,
  sortKey,
  direction,
  onSort,
  align = "left",
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  direction: "asc" | "desc";
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const isActive = sortKey === k;
  return (
    <th className={`py-1.5 px-2 first:pl-3 last:pr-3 ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 text-[11px] font-medium transition ${
          align === "right" ? "flex-row-reverse" : ""
        } ${isActive ? "text-[#1d1d1f]" : "text-[#86868b] hover:text-[#1d1d1f]"}`}
      >
        {label}
        {isActive && <span aria-hidden>{direction === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}

export function CommSharingTable({ properties }: { properties: PropertyOption[] }) {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 3 }, (_, i) => currentYear - 1 + i);
  const bonusEciByReference = useMemo(
    () => new Map(properties.map((p) => [p.reference.trim().toLowerCase(), p.bonusEciPercent])),
    [properties]
  );
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [rows, setRows] = useState<CommSharingRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alreadyRecordedDescriptions, setAlreadyRecordedDescriptions] = useState<Set<string>>(new Set());
  // null = "toutes les lignes ECI sélectionnées" (valeur par défaut tant que
  // l'utilisateur n'a pas touché à la sélection pour ce chargement).
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string> | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ year: String(year), month: String(month) });
      const res = await fetch(`/api/finance/comm-sharing?${params.toString()}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setRows(null);
      } else {
        setRows(data.rows);
        setAlreadyRecordedDescriptions(new Set(data.alreadyRecordedDescriptions ?? []));
        setSelectedRowIds(null);
      }
    } catch {
      setError("Impossible de charger le tableau Monday.com.");
    } finally {
      setLoading(false);
    }
  }

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDirection("asc");
    }
  }

  const rowsWithBonus = useMemo(() => {
    if (!rows) return null;
    return rows.map((r) => {
      const is8mor = r.flat?.trim().toLowerCase() === "8mor";
      // 8MOR n'a pas (ou plus) de bonus_eci_percent configuré côté M.G.B —
      // toujours 50% pour ce bien, quoi que dise Supabase.
      const bonusEciPercent = is8mor ? 50 : r.flat ? (bonusEciByReference.get(r.flat.trim().toLowerCase()) ?? null) : null;
      const isEci = r.label != null && ECI_LABEL_PATTERN.test(r.label);
      const amountDue = isEci && r.price != null && bonusEciPercent != null ? (r.price * bonusEciPercent) / 100 : null;
      // La colonne Text Monday de 8MOR ne contient pas une vraie référence
      // de réservation — ne pas l'afficher/exporter pour ce bien.
      const reservationRef = is8mor ? null : r.reservationRef;

      // Même construction que l'export CSV (ligne Price = revenu manager,
      // ligne Montant dû = dépense prestataire), calculée une seule fois ici
      // pour être réutilisée à la fois par l'export et par le recoupement
      // "déjà enregistré" (comparaison de description, voir
      // getRecordedEarlyCheckinDescriptions côté lib/vrplatform.ts).
      const ref = reservationRef ?? r.flat ?? r.id;
      const dateLabel = formatDate(r.date);
      const isoDate = r.date ? r.date.slice(0, 10) : "";
      const billIdBase = `${r.flat ?? r.id}-ECI-${r.id}`;
      const revenueDescription = `ECI Manager — ${ref} — ${dateLabel}`;
      const expenseDescription = `ECI Prestataire — ${ref} — ${dateLabel}`;
      const alreadyRecorded =
        alreadyRecordedDescriptions.has(revenueDescription) || alreadyRecordedDescriptions.has(expenseDescription);

      return {
        ...r,
        reservationRef,
        bonusEciPercent,
        amountDue,
        isoDate,
        billIdBase,
        revenueDescription,
        expenseDescription,
        alreadyRecorded,
      };
    });
  }, [rows, bonusEciByReference, alreadyRecordedDescriptions]);

  const filteredRows = useMemo(() => {
    if (!rowsWithBonus) return null;
    const needle = search.trim().toLowerCase();
    return needle === ""
      ? rowsWithBonus
      : rowsWithBonus.filter((r) =>
          [r.name, r.reservationRef, r.flat, r.label, r.prestataire].some((v) => v?.toLowerCase().includes(needle))
        );
  }, [rowsWithBonus, search]);

  const sortedRows = useMemo(() => {
    if (!filteredRows) return null;
    return [...filteredRows].sort((a, b) => {
      let cmp: number;
      switch (sortKey) {
        case "name":
          cmp = a.name.localeCompare(b.name, "fr");
          break;
        case "reservationRef":
          cmp = (a.reservationRef ?? "").localeCompare(b.reservationRef ?? "", "fr");
          break;
        case "date":
          cmp = (a.date ?? "").localeCompare(b.date ?? "");
          break;
        case "flat":
          cmp = (a.flat ?? "").localeCompare(b.flat ?? "", "fr");
          break;
        case "price":
          cmp = (a.price ?? 0) - (b.price ?? 0);
          break;
        case "label":
          cmp = (a.label ?? "").localeCompare(b.label ?? "", "fr");
          break;
        case "prestataire":
          cmp = (a.prestataire ?? "").localeCompare(b.prestataire ?? "", "fr");
          break;
        case "billToOwner":
          cmp = (a.billToOwner ?? "").localeCompare(b.billToOwner ?? "");
          break;
        case "amountDue":
          cmp = (a.amountDue ?? 0) - (b.amountDue ?? 0);
          break;
      }
      return direction === "asc" ? cmp : -cmp;
    });
  }, [filteredRows, sortKey, direction]);

  const total = sortedRows?.reduce((sum, r) => sum + (r.price ?? 0), 0) ?? 0;
  const totalDue = sortedRows?.reduce((sum, r) => sum + (r.amountDue ?? 0), 0) ?? 0;

  // Lignes éligibles à l'export (Price et Montant dû connus) parmi
  // sortedRows (donc déjà filtrées par la recherche).
  const eciRows = useMemo(() => sortedRows?.filter((r) => r.amountDue != null && r.price != null) ?? [], [sortedRows]);
  const eciRowIds = useMemo(() => new Set(eciRows.map((r) => r.id)), [eciRows]);
  const effectiveSelectedIds = selectedRowIds ?? eciRowIds;
  const selectedEciRows = eciRows.filter((r) => effectiveSelectedIds.has(r.id));
  const alreadyRecordedCount = eciRows.filter((r) => r.alreadyRecorded).length;
  // Le Deposit (encaissement du paiement guest) ne peut cibler que les
  // réservations qui existent réellement dans VRPlatform via la colonne
  // "Reservation" — exclut donc 8MOR, dont les réservations n'y sont pas
  // synchronisées (reservationRef est déjà nullifié pour 8MOR plus haut).
  const eciDepositRows = selectedEciRows.filter((r) => r.reservationRef != null);

  function toggleRowSelection(id: string) {
    setSelectedRowIds((prev) => {
      const next = new Set(prev ?? eciRowIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function escapeExpenseCsvField(value: string): string {
    return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  }

  /** Export VRPlatform "Expenses" — deux lignes par ligne Early Check-in
   * sélectionnée, toutes deux sur le compte Early Check-ins, Bill to Owner
   * FALSE (transaction manager/prestataire, le propriétaire n'est pas
   * concerné) : le Price est le revenu du manager, le Montant dû (Bonus
   * ECI) est la dépense payée au prestataire (négatif, Contact =
   * prestataire). */
  function exportExpensesCsv() {
    if (selectedEciRows.length === 0) return;
    const header = [
      "Issue Date",
      "Payment Date",
      "Description",
      "Status",
      "Bank/CC account",
      "Contact",
      "Bill ID",
      "Currency",
      "Listing",
      "Reservation",
      "Line Description",
      "Expense account",
      "Bill to Owner",
      "Applied amount",
      "Markup",
      "Markup Tax",
    ];
    const csvRows: string[][] = [header];
    for (const r of selectedEciRows) {
      csvRows.push([
        r.isoDate,
        r.isoDate,
        r.revenueDescription,
        "Unpaid",
        "",
        "info@melvanebydesign.com",
        `${r.billIdBase}-REV`,
        "EUR",
        r.flat ?? "",
        r.reservationRef ?? "",
        r.revenueDescription,
        "Early Check-ins",
        "FALSE",
        r.price!.toFixed(2),
        "",
        "",
      ]);

      csvRows.push([
        r.isoDate,
        r.isoDate,
        r.expenseDescription,
        "Unpaid",
        "",
        r.prestataire ?? "",
        `${r.billIdBase}-EXP`,
        "EUR",
        r.flat ?? "",
        r.reservationRef ?? "",
        r.expenseDescription,
        "Early Check-ins",
        "FALSE",
        (-r.amountDue!).toFixed(2),
        "",
        "",
      ]);
    }
    const csvContent = csvRows.map((row) => row.map(escapeExpenseCsvField).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `eci_expenses_${year}_${String(month).padStart(2, "0")}_vrplatform.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Export VRPlatform "Deposits" — un seul dépôt (même Reference/Date/
   * Description, regroupées par VRPlatform en un seul enregistrement) avec
   * une ligne par réservation sélectionnée : encaisse le paiement ECI du
   * guest en le rattachant directement à la réservation (colonne
   * Reservation), ce qui le fait apparaître dans les Financials de la
   * réservation. Exclut 8MOR, dont les réservations n'existent pas dans
   * VRPlatform (voir eciDepositRows). */
  function exportDepositCsv() {
    if (eciDepositRows.length === 0) return;
    const header = [
      "Date",
      "Reference",
      "Bank/CC Account",
      "Description",
      "Currency",
      "Reservation",
      "Contact",
      "Listing",
      "Account",
      "Bill to Owner",
      "Line Description",
      "Applied Amount",
      "Merchant Fee",
      "Channel Fee",
      "Reserve",
      "Co-Host",
      "VAT",
    ];
    const today = new Date().toISOString().slice(0, 10);
    const reference = `ECI-${year}${String(month).padStart(2, "0")}`;
    const description = `Dépôt ECI — ${MONTH_LABELS_SHORT[month - 1]} ${String(year).slice(-2)}`;
    const csvRows: string[][] = [header];
    for (const r of eciDepositRows) {
      csvRows.push([
        today,
        reference,
        "",
        description,
        "EUR",
        r.reservationRef ?? "",
        "",
        "",
        "",
        "",
        "",
        r.price!.toFixed(2),
        "",
        "",
        "",
        "",
        "",
      ]);
    }
    const csvContent = csvRows.map((row) => row.map(escapeExpenseCsvField).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `eci_deposit_${year}_${String(month).padStart(2, "0")}_vrplatform.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-[#6e6e73]">
        Tableau « Comm Sharing » Monday.com (facturation Sweep It) du mois sélectionné — lecture seule, en direct.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="field-label" htmlFor="comm-sharing-year">
            Année
          </label>
          <select
            id="comm-sharing-year"
            value={year}
            onChange={(e) => setYear(Number.parseInt(e.target.value, 10))}
            className="mt-1 h-9 rounded-[10px] border border-black/10 bg-white px-3 text-[14px] text-[#1d1d1f] shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus:border-[#0071e3] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
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
          <div className="mt-1 flex flex-wrap gap-1 max-w-[320px]">
            {MONTH_LABELS_SHORT.map((label, i) => {
              const m = i + 1;
              const active = month === m;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setMonth(m)}
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
          <span className="field-label invisible">Charger</span>
          <button type="button" onClick={load} disabled={loading} className="btn-secondary btn-sm mt-1 h-9">
            {loading ? "Chargement…" : rows ? "Actualiser" : "Charger"}
          </button>
        </div>
      </div>

      {rows && (
        <div>
          <label className="field-label" htmlFor="comm-sharing-search">
            Recherche (bien, ref resa, prestataire, label)
          </label>
          <input
            id="comm-sharing-search"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ex: 8MOR, Housekeeping, sweepit…"
            className="mt-1 w-72 rounded-[10px] border border-black/10 bg-white px-3 py-2 text-[14px] text-[#1d1d1f] shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus:border-[#0071e3] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
          />
        </div>
      )}

      {error && <p className="text-[13px] text-red-600">{error}</p>}

      {sortedRows && sortedRows.length === 0 && !loading && !error && (
        <p className="text-[13px] text-[#6e6e73]">Aucune ligne pour ce mois (ou ce filtre).</p>
      )}

      {sortedRows && sortedRows.length > 0 && !loading && !error && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="rounded-full bg-[#0071e3]/10 px-3 py-1.5 text-[13px] font-semibold text-[#0071e3]">
              {sortedRows.length} ligne{sortedRows.length !== 1 ? "s" : ""} · {formatEuros(total)} · {formatEuros(totalDue)}{" "}
              dû (Bonus ECI)
            </span>
            {alreadyRecordedCount > 0 && (
              <span className="text-[13px] text-amber-600">
                {alreadyRecordedCount} ECI déjà enregistré{alreadyRecordedCount !== 1 ? "s" : ""} côté VRPlatform
              </span>
            )}
            <div className="ml-auto flex items-center gap-2">
              {eciRowIds.size > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setSelectedRowIds(new Set(eciRowIds))}
                    className="text-[12px] font-medium text-[#0071e3] hover:underline"
                  >
                    Tout sélectionner
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedRowIds(new Set())}
                    className="text-[12px] font-medium text-[#0071e3] hover:underline"
                  >
                    Tout désélectionner
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={exportDepositCsv}
                disabled={eciDepositRows.length === 0}
                title="Un seul dépôt regroupant toutes les réservations sélectionnées (Reference commune), chaque ligne rattachée à sa réservation via la colonne Reservation — exclut 8MOR (pas de réservation VRPlatform)"
                className="btn-secondary btn-sm"
              >
                Exporter Deposit (CSV) ({eciDepositRows.length})
              </button>
              <button
                type="button"
                onClick={exportExpensesCsv}
                disabled={selectedEciRows.length === 0}
                title="Deux lignes par Early Check-in sélectionnée, compte Early Check-ins : Price en revenu manager, Montant dû en dépense prestataire (négatif), Bill to Owner FALSE"
                className="btn-secondary btn-sm"
              >
                Exporter Expense (CSV) ({selectedEciRows.length})
              </button>
            </div>
          </div>
          <div className="overflow-hidden rounded-[14px] border border-black/[0.06]">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-black/[0.08] bg-black/[0.015]">
                    <th className="py-1.5 pl-3 pr-1 text-left text-[11px] font-medium text-[#86868b]"></th>
                    <SortHeader label="Name" k="name" sortKey={sortKey} direction={direction} onSort={handleSort} />
                    <SortHeader label="Ref Resa" k="reservationRef" sortKey={sortKey} direction={direction} onSort={handleSort} />
                    <SortHeader label="Date" k="date" sortKey={sortKey} direction={direction} onSort={handleSort} align="right" />
                    <SortHeader label="Flat" k="flat" sortKey={sortKey} direction={direction} onSort={handleSort} />
                    <SortHeader label="Label" k="label" sortKey={sortKey} direction={direction} onSort={handleSort} />
                    <SortHeader label="Prestataire" k="prestataire" sortKey={sortKey} direction={direction} onSort={handleSort} />
                    <SortHeader label="Price" k="price" sortKey={sortKey} direction={direction} onSort={handleSort} align="right" />
                    <SortHeader
                      label="Bill to Owner"
                      k="billToOwner"
                      sortKey={sortKey}
                      direction={direction}
                      onSort={handleSort}
                      align="right"
                    />
                    <th className="py-1.5 px-2 text-right text-[11px] font-medium text-[#86868b]">Bonus ECI %</th>
                    <SortHeader
                      label="Montant dû"
                      k="amountDue"
                      sortKey={sortKey}
                      direction={direction}
                      onSort={handleSort}
                      align="right"
                    />
                    <th className="py-1.5 pl-2 pr-3 text-left text-[11px] font-medium text-[#86868b]">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row, rowIndex) => (
                    <tr
                      key={row.id}
                      className={`border-b border-black/[0.04] transition-colors last:border-b-0 hover:bg-[#dceafb] ${
                        rowIndex % 2 === 0 ? "bg-white" : "bg-[#f0f6fd]"
                      }`}
                    >
                      <td className="py-1.5 pl-3 pr-1 text-center">
                        {row.amountDue != null && row.price != null && (
                          <input
                            type="checkbox"
                            checked={effectiveSelectedIds.has(row.id)}
                            onChange={() => toggleRowSelection(row.id)}
                            className="h-3.5 w-3.5 accent-[#0071e3]"
                          />
                        )}
                      </td>
                      <td className="py-1.5 px-2 font-medium text-[#1d1d1f]">{row.name}</td>
                      <td className="py-1.5 px-2 text-[#1d1d1f]">{row.reservationRef ?? "—"}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">{formatDate(row.date)}</td>
                      <td className="py-1.5 px-2 text-[#1d1d1f]">{row.flat ?? "—"}</td>
                      <td className="py-1.5 px-2 text-[#1d1d1f]">{row.label ?? "—"}</td>
                      <td className="py-1.5 px-2 text-[#6e6e73]">{row.prestataire ?? "—"}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">
                        {row.price != null ? formatEuros(row.price) : "—"}
                      </td>
                      <td className="py-1.5 px-2 text-right text-[#1d1d1f]">{row.billToOwner ?? "—"}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-[#6e6e73]">
                        {row.bonusEciPercent != null ? `${row.bonusEciPercent}%` : "—"}
                      </td>
                      <td className="py-1.5 pl-2 pr-3 text-right tabular-nums font-semibold text-[#1d1d1f]">
                        {row.amountDue != null ? formatEuros(row.amountDue) : "—"}
                      </td>
                      <td className="py-1.5 pl-2 pr-3 text-left">
                        {row.amountDue != null && row.price != null && (
                          row.alreadyRecorded ? (
                            <span className="text-[11px] font-medium text-amber-600">✓ Déjà enreg.</span>
                          ) : (
                            <span className="text-[11px] font-medium text-emerald-600">Nouveau</span>
                          )
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-black/[0.08] bg-black/[0.015] font-semibold text-[#1d1d1f]">
                    <td className="py-1.5 pl-3 pr-2" colSpan={7}>
                      Total ({sortedRows.length} ligne{sortedRows.length !== 1 ? "s" : ""})
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{formatEuros(total)}</td>
                    <td className="py-1.5 px-2"></td>
                    <td className="py-1.5 px-2"></td>
                    <td className="py-1.5 pl-2 pr-3 text-right tabular-nums">{formatEuros(totalDue)}</td>
                    <td className="py-1.5 pl-2 pr-3"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {!rows && !loading && !error && (
        <p className="text-[13px] text-[#6e6e73]">Choisis une année et un mois, puis charge les données.</p>
      )}
    </div>
  );
}
