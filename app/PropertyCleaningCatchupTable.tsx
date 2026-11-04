"use client";

import { useMemo, useState } from "react";
import { formatEuros, MONTH_LABELS_SHORT } from "@/lib/format";
import type { RentType } from "@/lib/types";

interface PropertyOption {
  id: string;
  reference: string;
  tags: string[];
  rentType: RentType | null;
}

interface CatchupApiRow {
  propertyId: string;
  reference: string;
  reservationId: string;
  guestName: string | null;
  bookingPlatform: string | null;
  confirmationCode: string | null;
  bookedAt: string | null;
  checkIn: string;
  checkOut: string;
  grossCents: number;
  platformCommissionCents: number;
  cleaningFeeCents: number | null;
  cleaningError: string | null;
  /** Taux de commission M.G.B. du bien, ex: 20 pour 20 % — null si non
   * configuré. */
  commissionPercent: number | null;
}

interface CatchupRow extends CatchupApiRow {
  sumCents: number | null;
  /** % que représente la commission plateforme (déjà connue en euros) par
   * rapport à Brut + Ménage — null si le ménage n'est pas connu. */
  effectivePercent: number | null;
  /** Commission plateforme / Brut seul (sans tenir compte du ménage), en
   * pourcentage — null si Brut est nul. C'est la colonne "Comm. sur Brut". */
  percentOnGrossOnly: number | null;
  /** Part de la commission plateforme imputable au Ménage au prorata
   * Ménage/(Brut+Ménage) — le rattrapage à reporter sur le propriétaire,
   * puisqu'aujourd'hui tout est imputé au Brut alors que la plateforme
   * prélève sa commission sur l'ensemble payé par le client (loyer +
   * ménage). Null si le ménage n'est pas connu. C'est la colonne "Comm
   * Ménage". */
  commissionOnCleaningCents: number | null;
  /** Commission M.G.B. supplémentaire à facturer sur ce rattrapage — Comm
   * Ménage × le taux de commission M.G.B. du bien, affiché en négatif
   * (coût pour le propriétaire). Null si Comm Ménage ou le taux de
   * commission ne sont pas connus. */
  additionalCommissionCents: number | null;
  /** PNL = Comm Ménage − Comm Supp (Comm Supp étant négatif, ça revient à
   * additionner les deux) — null si l'un des deux n'est pas connu. */
  pnlCents: number | null;
}

type SortKey =
  | "reference"
  | "bookedAt"
  | "checkIn"
  | "gross"
  | "cleaning"
  | "sum"
  | "platformCommission"
  | "percentOnGrossOnly"
  | "commissionOnCleaning"
  | "additionalCommission"
  | "pnl";

type ColumnKey =
  | "reference"
  | "bookedAt"
  | "stay"
  | "platform"
  | "confirmationCode"
  | "gross"
  | "cleaning"
  | "sum"
  | "platformCommission"
  | "effectivePercent"
  | "percentOnGrossOnly"
  | "commissionOnCleaning"
  | "commissionPercent"
  | "additionalCommission"
  | "pnl";

const ALL_COLUMNS: ColumnKey[] = [
  "reference",
  "bookedAt",
  "stay",
  "platform",
  "confirmationCode",
  "gross",
  "cleaning",
  "sum",
  "platformCommission",
  "effectivePercent",
  "percentOnGrossOnly",
  "commissionOnCleaning",
  "commissionPercent",
  "additionalCommission",
  "pnl",
];

const COLUMN_LABELS: Record<ColumnKey, string> = {
  reference: "Bien",
  bookedAt: "Date résa",
  stay: "Séjour",
  platform: "Plateforme",
  confirmationCode: "Référence",
  gross: "Brut",
  cleaning: "Ménage",
  sum: "Commissionable Amount",
  platformCommission: "Comm OTA",
  effectivePercent: "% (Brut+Ménage)",
  percentOnGrossOnly: "% Brut",
  commissionOnCleaning: "Comm Ménage",
  commissionPercent: "Comm Melvane",
  additionalCommission: "Comm Supp",
  pnl: "PNL Owner",
};

function toRow(r: CatchupApiRow): CatchupRow {
  const sumCents = r.cleaningFeeCents != null ? r.grossCents + r.cleaningFeeCents : null;
  const effectivePercent = sumCents != null && sumCents > 0 ? (r.platformCommissionCents / sumCents) * 100 : null;
  const percentOnGrossOnly = r.grossCents > 0 ? (r.platformCommissionCents / r.grossCents) * 100 : null;
  const commissionOnCleaningCents =
    sumCents == null ? null : sumCents > 0 ? Math.round((r.platformCommissionCents * (r.cleaningFeeCents ?? 0)) / sumCents) : 0;
  const additionalCommissionCents =
    commissionOnCleaningCents != null && r.commissionPercent != null
      ? -Math.round((commissionOnCleaningCents * r.commissionPercent) / 100)
      : null;
  const pnlCents =
    commissionOnCleaningCents != null && additionalCommissionCents != null
      ? commissionOnCleaningCents - additionalCommissionCents
      : null;
  return { ...r, sumCents, effectivePercent, percentOnGrossOnly, commissionOnCleaningCents, additionalCommissionCents, pnlCents };
}

function Money({ cents, bold = false }: { cents: number | null; bold?: boolean }) {
  if (cents == null) return <span className="text-[#6e6e73]">—</span>;
  return <span className={bold ? "font-semibold" : undefined}>{formatEuros(cents / 100)}</span>;
}

function SignedMoney({ cents, bold = false }: { cents: number | null; bold?: boolean }) {
  if (cents == null) return <span className="text-[#6e6e73]">—</span>;
  return (
    <span className={`${bold ? "font-semibold " : ""}${cents >= 0 ? "text-emerald-600" : "text-red-600"}`}>
      {cents >= 0 ? "+" : ""}
      {formatEuros(cents / 100)}
    </span>
  );
}

function Percent({ value }: { value: number | null }) {
  if (value == null) return <span className="text-[#6e6e73]">—</span>;
  return <span>{value.toFixed(1)} %</span>;
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "2-digit", timeZone: "UTC" });
}

function SortHeader({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
  align = "right",
  title,
  wrap = false,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  direction: "asc" | "desc";
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
  title?: string;
  /** Force le libellé sur deux lignes au lieu d'élargir la colonne. */
  wrap?: boolean;
}) {
  const isActive = activeKey === sortKey;
  return (
    <th className={`py-1 px-1.5 first:pl-3 last:pr-3 ${align === "right" ? "text-right" : "text-left"}`} title={title}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 text-[11px] font-medium transition ${
          align === "right" ? "flex-row-reverse" : ""
        } ${isActive ? "text-[#1d1d1f]" : "text-[#86868b] hover:text-[#1d1d1f]"}`}
      >
        <span className={wrap ? "max-w-[70px] whitespace-normal leading-tight" : undefined}>{label}</span>
        {isActive && <span aria-hidden>{direction === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}

/** Onglet "Rattrapage Ménage" — la commission prélevée par la plateforme de
 * réservation (Airbnb...) est un montant en euros déjà connu côté
 * VRPlatform, mais aujourd'hui entièrement imputé au Brut (Rents) dans les
 * comptes — alors que la plateforme la prélève en réalité sur tout ce que
 * paie le client, ménage compris. Ce tableau répartit ce montant déjà
 * connu au prorata Brut/(Brut+Ménage) : la part qui retombe sur le ménage
 * est le rattrapage à reporter sur le propriétaire. */
export function PropertyCleaningCatchupTable({ properties: unsortedProperties }: { properties: PropertyOption[] }) {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 4 + i);
  const allProperties = useMemo(
    () => [...unsortedProperties].sort((a, b) => a.reference.localeCompare(b.reference, "fr")),
    [unsortedProperties]
  );
  const allTags = useMemo(
    () => Array.from(new Set(allProperties.flatMap((p) => p.tags))).sort((a, b) => a.localeCompare(b, "fr")),
    [allProperties]
  );

  const [year, setYear] = useState(currentYear);
  const [selectedMonths, setSelectedMonths] = useState<number[]>([new Date().getMonth() + 1]);
  const [showPeriodPicker, setShowPeriodPicker] = useState(false);
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>(() => allProperties.map((p) => p.id));
  const [showProperties, setShowProperties] = useState(false);
  const [tagFilters, setTagFilters] = useState<Record<string, "include" | "exclude">>({});
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [rows, setRows] = useState<CatchupApiRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("checkIn");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [hiddenColumns, setHiddenColumns] = useState<Set<ColumnKey>>(new Set());
  const [selectedReservationIds, setSelectedReservationIds] = useState<Set<string>>(new Set());
  const [exportedByReservationId, setExportedByReservationId] = useState<Map<string, string>>(new Map());
  const [exportActionLoading, setExportActionLoading] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  function toggleColumn(col: ColumnKey) {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col);
      else next.add(col);
      return next;
    });
  }

  function toggleReservationSelection(reservationId: string) {
    setSelectedReservationIds((prev) => {
      const next = new Set(prev);
      if (next.has(reservationId)) next.delete(reservationId);
      else next.add(reservationId);
      return next;
    });
  }

  function toggleSelectAllVisible(visibleReservationIds: string[]) {
    setSelectedReservationIds((prev) => {
      const allSelected = visibleReservationIds.length > 0 && visibleReservationIds.every((id) => prev.has(id));
      if (allSelected) return new Set();
      return new Set(visibleReservationIds);
    });
  }

  const includedTags = useMemo(
    () => Object.entries(tagFilters).filter(([, mode]) => mode === "include").map(([tag]) => tag),
    [tagFilters]
  );
  const excludedTags = useMemo(
    () => Object.entries(tagFilters).filter(([, mode]) => mode === "exclude").map(([tag]) => tag),
    [tagFilters]
  );

  const matchingProperties = useMemo(() => {
    return allProperties.filter((p) => {
      const isSelected = selectedPropertyIds.includes(p.id);
      const matchesIncluded = includedTags.length === 0 || p.tags.some((t) => includedTags.includes(t));
      const matchesExcluded = excludedTags.length === 0 || !p.tags.some((t) => excludedTags.includes(t));
      return isSelected && matchesIncluded && matchesExcluded;
    });
  }, [allProperties, selectedPropertyIds, includedTags, excludedTags]);

  const allPlatforms = useMemo(
    () => (rows ? Array.from(new Set(rows.map((r) => r.bookingPlatform ?? "Inconnu"))).sort((a, b) => a.localeCompare(b, "fr")) : []),
    [rows]
  );

  function toggleMonth(month: number) {
    setSelectedMonths((prev) =>
      prev.includes(month) ? prev.filter((m) => m !== month) : [...prev, month].sort((a, b) => a - b)
    );
  }

  function toggleProperty(id: string) {
    setSelectedPropertyIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  function cycleTagFilter(tag: string) {
    setTagFilters((prev) => {
      const next = { ...prev };
      if (next[tag] === "include") next[tag] = "exclude";
      else if (next[tag] === "exclude") delete next[tag];
      else next[tag] = "include";
      return next;
    });
  }

  function togglePlatform(name: string) {
    setSelectedPlatforms((prev) => (prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name]));
  }

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDirection(key === "checkIn" || key === "bookedAt" || key === "reference" ? "asc" : "desc");
    }
  }

  async function load() {
    if (matchingProperties.length === 0) {
      setError("Aucun bien ne correspond aux filtres.");
      return;
    }
    if (selectedMonths.length === 0) {
      setError("Sélectionne au moins un mois.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        propertyIds: matchingProperties.map((p) => p.id).join(","),
        year: String(year),
        months: selectedMonths.join(","),
      });
      const res = await fetch(`/api/finance/cleaning-commission-catchup?${params.toString()}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setRows(null);
      } else {
        setRows(data.rows);
        setSelectedPlatforms([]);
        setSelectedReservationIds(new Set());
        await loadExportStatus((data.rows as CatchupApiRow[]).map((r) => r.reservationId));
      }
    } catch {
      setError("Impossible de charger le rattrapage ménage.");
    } finally {
      setLoading(false);
    }
  }

  async function loadExportStatus(reservationIds: string[]) {
    if (reservationIds.length === 0) {
      setExportedByReservationId(new Map());
      return;
    }
    try {
      const params = new URLSearchParams({ reservationIds: reservationIds.join(",") });
      const res = await fetch(`/api/finance/cleaning-commission-catchup/exports?${params.toString()}`);
      const data = await res.json();
      if (!data.error) {
        setExportedByReservationId(
          new Map((data.exports as { reservationId: string; exportedAt: string }[]).map((e) => [e.reservationId, e.exportedAt]))
        );
      }
    } catch {
      // Dégradation silencieuse — l'absence de statut d'export n'empêche pas d'afficher le tableau.
    }
  }

  async function markSelectedAsExported() {
    if (!sortedRows || selectedReservationIds.size === 0) return;
    setExportActionLoading(true);
    setExportError(null);
    try {
      const selectedRows = sortedRows.filter((r) => selectedReservationIds.has(r.reservationId));
      const res = await fetch("/api/finance/cleaning-commission-catchup/exports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: selectedRows.map((r) => ({
            reservationId: r.reservationId,
            propertyId: r.propertyId,
            propertyReference: r.reference,
            checkoutDate: r.checkOut,
            commissionOnCleaningCents: r.commissionOnCleaningCents ?? 0,
            additionalCommissionCents: r.additionalCommissionCents ?? 0,
            pnlCents: r.pnlCents ?? 0,
          })),
        }),
      });
      const data = await res.json();
      if (data.error) {
        setExportError(data.error);
      } else {
        const now = new Date().toISOString();
        setExportedByReservationId((prev) => {
          const next = new Map(prev);
          for (const id of selectedReservationIds) next.set(id, now);
          return next;
        });
      }
    } catch {
      setExportError("Impossible de marquer ces réservations comme exportées.");
    } finally {
      setExportActionLoading(false);
    }
  }

  async function unmarkSelectedAsExported() {
    if (selectedReservationIds.size === 0) return;
    setExportActionLoading(true);
    setExportError(null);
    try {
      const params = new URLSearchParams({ reservationIds: Array.from(selectedReservationIds).join(",") });
      const res = await fetch(`/api/finance/cleaning-commission-catchup/exports?${params.toString()}`, { method: "DELETE" });
      const data = await res.json();
      if (data.error) {
        setExportError(data.error);
      } else {
        setExportedByReservationId((prev) => {
          const next = new Map(prev);
          for (const id of selectedReservationIds) next.delete(id);
          return next;
        });
      }
    } catch {
      setExportError("Impossible d'annuler l'export de ces réservations.");
    } finally {
      setExportActionLoading(false);
    }
  }

  /** Même format d'import "Expenses" VRPlatform que le Convertisseur CSV
   * (Issue Date/Payment Date/Description/Status/Bank-CC account/Contact/
   * Bill ID/Currency/Listing/Reservation/Line Description/Expense account/
   * Bill to Owner/Applied amount/Markup/Markup Tax), avec deux lignes par
   * réservation sélectionnée, toutes Bill to Owner = TRUE :
   * - Housekeeping, +Comm Ménage : rattrapage crédité au propriétaire.
   * - Payout Adjustments, +Comm Supp (signe inversé — négatif dans le
   *   tableau car coût pour le propriétaire, positif ici car crédité au
   *   manager) : commission M.G.B. supplémentaire sur le ménage. */
  function exportSelectedAsCsv() {
    if (!sortedRows || selectedReservationIds.size === 0) return;
    const selectedRows = sortedRows.filter((r) => selectedReservationIds.has(r.reservationId));
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
    const escapeCsvField = (value: string): string => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
    const csvRows: string[][] = [header];
    const addLine = (
      r: CatchupRow,
      stayLabel: string,
      billIdSuffix: string,
      description: string,
      expenseAccount: string,
      appliedAmountCents: number
    ) => {
      csvRows.push([
        r.checkOut,
        r.checkOut,
        `${description} — ${stayLabel}`,
        "Paid",
        "Non-Trust Account",
        "info@melvanebydesign.com",
        `${r.confirmationCode ?? r.reservationId}-${billIdSuffix}`,
        "EUR",
        r.reference,
        "",
        description,
        expenseAccount,
        "TRUE",
        (appliedAmountCents / 100).toFixed(2),
        "",
        "",
      ]);
    };
    for (const r of selectedRows) {
      const stayLabel = `${r.confirmationCode ?? r.reservationId} (${r.checkOut})`;
      if (r.commissionOnCleaningCents != null && r.commissionOnCleaningCents !== 0) {
        addLine(r, stayLabel, "RM", "Rattrapage commission ménage", "Housekeeping", r.commissionOnCleaningCents);
      }
      if (r.additionalCommissionCents != null && r.additionalCommissionCents !== 0) {
        addLine(r, stayLabel, "CS", "Commission ménage", "Payout Adjustments", -r.additionalCommissionCents);
      }
    }
    const csvContent = csvRows.map((row) => row.map(escapeCsvField).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rattrapage_menage_${year}_vrplatform.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const filteredRows = rows
    ? rows.filter((r) => selectedPlatforms.length === 0 || selectedPlatforms.includes(r.bookingPlatform ?? "Inconnu"))
    : null;

  const sortedRows = filteredRows
    ? [...filteredRows.map(toRow)].sort((a, b) => {
        let cmp: number;
        switch (sortKey) {
          case "reference":
            cmp = a.reference.localeCompare(b.reference, "fr");
            break;
          case "checkIn":
            cmp = a.checkIn.localeCompare(b.checkIn);
            break;
          case "bookedAt":
            cmp = (a.bookedAt ?? "").localeCompare(b.bookedAt ?? "");
            break;
          case "gross":
            cmp = a.grossCents - b.grossCents;
            break;
          case "cleaning":
            cmp = (a.cleaningFeeCents ?? 0) - (b.cleaningFeeCents ?? 0);
            break;
          case "sum":
            cmp = (a.sumCents ?? 0) - (b.sumCents ?? 0);
            break;
          case "platformCommission":
            cmp = a.platformCommissionCents - b.platformCommissionCents;
            break;
          case "percentOnGrossOnly":
            cmp = (a.percentOnGrossOnly ?? 0) - (b.percentOnGrossOnly ?? 0);
            break;
          case "commissionOnCleaning":
            cmp = (a.commissionOnCleaningCents ?? 0) - (b.commissionOnCleaningCents ?? 0);
            break;
          case "additionalCommission":
            cmp = (a.additionalCommissionCents ?? 0) - (b.additionalCommissionCents ?? 0);
            break;
          case "pnl":
            cmp = (a.pnlCents ?? 0) - (b.pnlCents ?? 0);
            break;
        }
        return direction === "asc" ? cmp : -cmp;
      })
    : null;

  const totals = sortedRows
    ? {
        grossCents: sortedRows.reduce((sum, r) => sum + r.grossCents, 0),
        cleaningFeeCents: sortedRows.reduce((sum, r) => sum + (r.cleaningFeeCents ?? 0), 0),
        sumCents: sortedRows.reduce((sum, r) => sum + (r.sumCents ?? r.grossCents), 0),
        platformCommissionCents: sortedRows.reduce((sum, r) => sum + r.platformCommissionCents, 0),
        commissionOnCleaningCents: sortedRows.reduce((sum, r) => sum + (r.commissionOnCleaningCents ?? 0), 0),
        additionalCommissionCents: sortedRows.reduce((sum, r) => sum + (r.additionalCommissionCents ?? 0), 0),
        pnlCents: sortedRows.reduce((sum, r) => sum + (r.pnlCents ?? 0), 0),
      }
    : null;

  const periodSummary =
    selectedMonths.length === 0
      ? "Aucun mois"
      : selectedMonths.length === 12
        ? `Année complète ${year}`
        : `${selectedMonths.map((m) => MONTH_LABELS_SHORT[m - 1]).join(", ")} ${year}`;

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-[#86868b]">
        La commission prélevée par la plateforme de réservation (Airbnb...) est un montant en euros déjà connu côté
        VRPlatform, mais aujourd&apos;hui entièrement imputé au Brut dans les comptes — alors qu&apos;elle est en
        réalité prélevée sur tout ce que paie le client, ménage compris. Ce tableau répartit ce montant déjà connu au
        prorata Brut/(Brut+Ménage) : la dernière colonne (part imputable au ménage) est le rattrapage à reporter sur
        le propriétaire.
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
                <label className="field-label" htmlFor="catchup-year">
                  Année
                </label>
                <select
                  id="catchup-year"
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

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowProperties((v) => !v)}
            className="flex items-center gap-2 rounded-[10px] border-2 border-[#0071e3] bg-white px-3 py-2 text-[13px] font-medium text-[#0071e3] transition hover:bg-[#0071e3]/5"
          >
            🏠 Choisir les biens ({selectedPropertyIds.length}/{allProperties.length})
            <span aria-hidden className={`transition-transform ${showProperties ? "rotate-180" : ""}`}>
              ▾
            </span>
          </button>
          <span className="rounded-full bg-[#0071e3]/10 px-3 py-1.5 text-[13px] font-semibold text-[#0071e3]">
            {matchingProperties.length} bien{matchingProperties.length !== 1 ? "s" : ""} sélectionné
            {matchingProperties.length !== 1 ? "s" : ""} (après filtres)
          </span>
        </div>
        {showProperties && (
          <>
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSelectedPropertyIds(allProperties.map((p) => p.id))}
                className="text-[12px] font-medium text-[#0071e3] hover:underline"
              >
                Tout sélectionner
              </button>
              <button
                type="button"
                onClick={() => setSelectedPropertyIds([])}
                className="text-[12px] font-medium text-[#0071e3] hover:underline"
              >
                Tout désélectionner
              </button>
            </div>
            <div className="mt-1 grid max-h-56 grid-cols-2 gap-x-4 gap-y-1 overflow-y-auto rounded-[10px] border border-black/10 bg-white p-3 sm:grid-cols-3 md:grid-cols-4">
              {allProperties.map((p) => (
                <label key={p.id} className="flex items-center gap-1.5 text-[13px] text-[#1d1d1f]">
                  <input
                    type="checkbox"
                    checked={selectedPropertyIds.includes(p.id)}
                    onChange={() => toggleProperty(p.id)}
                    className="h-3.5 w-3.5 rounded border-black/20 text-[#0071e3] focus:ring-[#0071e3]/40"
                  />
                  {p.reference}
                </label>
              ))}
            </div>
          </>
        )}
      </div>

      {allTags.length > 0 && (
        <div>
          <span className="field-label">Tags</span>
          <p className="mt-0.5 text-[11px] text-[#86868b]">Clic : inclure · reclic : exclure · reclic : neutre</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {allTags.map((tag) => {
              const mode = tagFilters[tag];
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => cycleTagFilter(tag)}
                  title={
                    mode === "include"
                      ? "Inclus — clic pour exclure"
                      : mode === "exclude"
                        ? "Exclu — clic pour désactiver"
                        : "Clic pour inclure"
                  }
                  className={`rounded-full border px-2.5 py-1 text-[13px] font-medium transition ${
                    mode === "include"
                      ? "border-[#0071e3] bg-[#0071e3] text-white"
                      : mode === "exclude"
                        ? "border-[#ff3b30] bg-[#ff3b30] text-white"
                        : "border-black/10 bg-white text-[#1d1d1f] hover:bg-black/[0.04]"
                  }`}
                >
                  {mode === "exclude" ? "− " : mode === "include" ? "+ " : ""}
                  {tag}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {rows && allPlatforms.length > 0 && (
        <div>
          <span className="field-label">Plateforme de réservation</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {allPlatforms.map((name) => {
              const active = selectedPlatforms.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => togglePlatform(name)}
                  className={`rounded-full border px-2.5 py-1 text-[13px] font-medium transition ${
                    active
                      ? "border-[#0071e3] bg-[#0071e3] text-white"
                      : "border-black/10 bg-white text-[#1d1d1f] hover:bg-black/[0.04]"
                  }`}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <span className="field-label">Colonnes</span>
        <div className="mt-1 flex flex-wrap gap-1">
          {ALL_COLUMNS.map((col) => {
            const visible = !hiddenColumns.has(col);
            return (
              <button
                key={col}
                type="button"
                onClick={() => toggleColumn(col)}
                className={`rounded-full border px-2.5 py-1 text-[13px] font-medium transition ${
                  visible
                    ? "border-[#0071e3] bg-[#0071e3] text-white"
                    : "border-black/10 bg-white text-[#86868b] hover:bg-black/[0.04]"
                }`}
              >
                {COLUMN_LABELS[col]}
              </button>
            );
          })}
        </div>
      </div>

      {error && <p className="text-[13px] text-red-600">{error}</p>}

      {sortedRows && totals && !loading && !error && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[13px] text-[#6e6e73]">
              {sortedRows.length} réservation{sortedRows.length !== 1 ? "s" : ""}
              {selectedReservationIds.size > 0 && ` · ${selectedReservationIds.size} sélectionnée${selectedReservationIds.size !== 1 ? "s" : ""}`}
            </p>
            {selectedReservationIds.size > 0 && (
              <>
                <button
                  type="button"
                  onClick={markSelectedAsExported}
                  disabled={exportActionLoading}
                  className="btn-secondary btn-sm"
                  title="Marque les réservations sélectionnées comme exportées, une fois l'écriture de rattrapage posée à la main dans VRPlatform"
                >
                  ✓ Marquer comme exporté
                </button>
                <button type="button" onClick={unmarkSelectedAsExported} disabled={exportActionLoading} className="btn-secondary btn-sm">
                  Annuler l&apos;export
                </button>
                <button type="button" onClick={exportSelectedAsCsv} className="btn-secondary btn-sm">
                  Exporter (CSV)
                </button>
              </>
            )}
          </div>
          {exportError && <p className="text-[13px] text-red-600">{exportError}</p>}

          {sortedRows.length === 0 ? (
            <p className="text-[13px] text-[#6e6e73]">Aucune réservation sur cette période.</p>
          ) : (
            <div className="overflow-hidden rounded-[14px] border border-black/[0.06]">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse whitespace-nowrap text-[11px]">
                  <thead>
                    <tr className="border-b border-black/[0.08] bg-black/[0.015]">
                      <th className="py-1 pl-3 pr-1.5">
                        <input
                          type="checkbox"
                          checked={sortedRows.length > 0 && sortedRows.every((r) => selectedReservationIds.has(r.reservationId))}
                          onChange={() => toggleSelectAllVisible(sortedRows.map((r) => r.reservationId))}
                          className="h-3.5 w-3.5 rounded border-black/20 text-[#0071e3] focus:ring-[#0071e3]/40"
                        />
                      </th>
                      {!hiddenColumns.has("reference") && (
                        <SortHeader label="Bien" sortKey="reference" activeKey={sortKey} direction={direction} onSort={handleSort} align="left" />
                      )}
                      {!hiddenColumns.has("bookedAt") && (
                        <SortHeader label="Date résa" sortKey="bookedAt" activeKey={sortKey} direction={direction} onSort={handleSort} />
                      )}
                      {!hiddenColumns.has("stay") && (
                        <th className="py-1 px-1.5 text-left text-[11px] font-medium text-[#86868b]">Séjour</th>
                      )}
                      {!hiddenColumns.has("platform") && (
                        <th className="py-1 px-1.5 text-left text-[11px] font-medium text-[#86868b]">Plateforme</th>
                      )}
                      {!hiddenColumns.has("confirmationCode") && (
                        <th className="py-1 px-1.5 text-left text-[11px] font-medium text-[#86868b]">Référence</th>
                      )}
                      {!hiddenColumns.has("gross") && (
                        <SortHeader label="Brut" sortKey="gross" activeKey={sortKey} direction={direction} onSort={handleSort} title="Rents, avant Comm OTA" />
                      )}
                      {!hiddenColumns.has("cleaning") && (
                        <SortHeader label="Ménage" sortKey="cleaning" activeKey={sortKey} direction={direction} onSort={handleSort} title="Prix ménage facturé au client (Guesty)" />
                      )}
                      {!hiddenColumns.has("sum") && (
                        <SortHeader label="Commissionable Amount" sortKey="sum" activeKey={sortKey} direction={direction} onSort={handleSort} title="Brut + Ménage" wrap />
                      )}
                      {!hiddenColumns.has("platformCommission") && (
                        <SortHeader
                          label="Comm OTA"
                          sortKey="platformCommission"
                          activeKey={sortKey}
                          direction={direction}
                          onSort={handleSort}
                          title="Montant déjà connu côté VRPlatform (Channel Commissions)"
                        />
                      )}
                      {!hiddenColumns.has("effectivePercent") && (
                        <th className="py-1 px-1.5 text-right text-[11px] font-medium text-[#86868b]" title="Comm OTA / (Brut + Ménage)">
                          % (Brut+Ménage)
                        </th>
                      )}
                      {!hiddenColumns.has("percentOnGrossOnly") && (
                        <SortHeader
                          label="% Brut"
                          sortKey="percentOnGrossOnly"
                          activeKey={sortKey}
                          direction={direction}
                          onSort={handleSort}
                          title="Comm OTA / Brut"
                        />
                      )}
                      {!hiddenColumns.has("commissionOnCleaning") && (
                        <SortHeader
                          label="Comm Ménage"
                          sortKey="commissionOnCleaning"
                          activeKey={sortKey}
                          direction={direction}
                          onSort={handleSort}
                          title="Part de la Comm OTA imputable au ménage — à rattraper sur le propriétaire"
                        />
                      )}
                      {!hiddenColumns.has("commissionPercent") && (
                        <th className="py-1 px-1.5 text-right text-[11px] font-medium text-[#86868b]" title="Taux de commission M.G.B. du bien">
                          Comm Melvane
                        </th>
                      )}
                      {!hiddenColumns.has("additionalCommission") && (
                        <SortHeader
                          label="Comm Supp"
                          sortKey="additionalCommission"
                          activeKey={sortKey}
                          direction={direction}
                          onSort={handleSort}
                          title="Comm Ménage × mon taux de commission, en négatif"
                        />
                      )}
                      {!hiddenColumns.has("pnl") && (
                        <SortHeader
                          label="PNL Owner"
                          sortKey="pnl"
                          activeKey={sortKey}
                          direction={direction}
                          onSort={handleSort}
                          title="Comm Ménage − Comm Supp"
                        />
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((r, rowIndex) => {
                      const exportedAt = exportedByReservationId.get(r.reservationId);
                      return (
                      <tr
                        key={r.reservationId}
                        className={`border-b border-black/[0.04] transition-colors last:border-b-0 hover:bg-[#dceafb] ${
                          exportedAt ? "opacity-50" : rowIndex % 2 === 0 ? "bg-white" : "bg-[#f0f6fd]"
                        }`}
                      >
                        <td className="py-1 pl-3 pr-1.5">
                          <input
                            type="checkbox"
                            checked={selectedReservationIds.has(r.reservationId)}
                            onChange={() => toggleReservationSelection(r.reservationId)}
                            className="h-3.5 w-3.5 rounded border-black/20 text-[#0071e3] focus:ring-[#0071e3]/40"
                          />
                        </td>
                        {!hiddenColumns.has("reference") && (
                          <td className="py-1 pl-2.5 pr-1.5 font-medium text-[#1d1d1f]">
                            {r.reference}
                            {r.cleaningError && (
                              <span title={`Guesty : ${r.cleaningError}`} className="ml-1.5 text-red-600">
                                ⚠
                              </span>
                            )}
                            {exportedAt && (
                              <span title={`Exporté le ${formatDate(exportedAt.slice(0, 10))}`} className="ml-1.5 text-emerald-600">
                                ✓
                              </span>
                            )}
                          </td>
                        )}
                        {!hiddenColumns.has("bookedAt") && (
                          <td className="py-1 px-1.5 text-[#6e6e73]">{r.bookedAt ? formatDate(r.bookedAt) : "—"}</td>
                        )}
                        {!hiddenColumns.has("stay") && (
                          <td className="py-1 px-1.5 text-[#6e6e73]" title={r.guestName ?? undefined}>
                            {formatDate(r.checkIn)} → {formatDate(r.checkOut)}
                          </td>
                        )}
                        {!hiddenColumns.has("platform") && (
                          <td className="py-1 px-1.5 text-[#6e6e73]">{r.bookingPlatform ?? "—"}</td>
                        )}
                        {!hiddenColumns.has("confirmationCode") && (
                          <td className="py-1 px-1.5 text-[#6e6e73]">{r.confirmationCode ?? "—"}</td>
                        )}
                        {!hiddenColumns.has("gross") && (
                          <td className="py-1 px-1.5 text-right tabular-nums text-[#1d1d1f]">
                            <Money cents={r.grossCents} />
                          </td>
                        )}
                        {!hiddenColumns.has("cleaning") && (
                          <td className="py-1 px-1.5 text-right tabular-nums text-[#1d1d1f]">
                            <Money cents={r.cleaningFeeCents} />
                          </td>
                        )}
                        {!hiddenColumns.has("sum") && (
                          <td className="py-1 px-1.5 text-right tabular-nums font-medium text-[#1d1d1f]">
                            <Money cents={r.sumCents} />
                          </td>
                        )}
                        {!hiddenColumns.has("platformCommission") && (
                          <td className="py-1 px-1.5 text-right tabular-nums text-[#1d1d1f]">
                            <Money cents={r.platformCommissionCents} />
                          </td>
                        )}
                        {!hiddenColumns.has("effectivePercent") && (
                          <td className="py-1 px-1.5 text-right tabular-nums text-[#1d1d1f]">
                            <Percent value={r.effectivePercent} />
                          </td>
                        )}
                        {!hiddenColumns.has("percentOnGrossOnly") && (
                          <td className="py-1 px-1.5 text-right tabular-nums text-[#1d1d1f]">
                            <Percent value={r.percentOnGrossOnly} />
                          </td>
                        )}
                        {!hiddenColumns.has("commissionOnCleaning") && (
                          <td className="py-1 px-1.5 text-right tabular-nums font-semibold text-[#0071e3]">
                            <Money cents={r.commissionOnCleaningCents} bold />
                          </td>
                        )}
                        {!hiddenColumns.has("commissionPercent") && (
                          <td className="py-1 px-1.5 text-right tabular-nums text-[#1d1d1f]">
                            {r.commissionPercent != null ? `${r.commissionPercent} %` : <span className="text-[#6e6e73]">—</span>}
                          </td>
                        )}
                        {!hiddenColumns.has("additionalCommission") && (
                          <td className="py-1 px-1.5 text-right tabular-nums font-semibold text-red-600">
                            <Money cents={r.additionalCommissionCents} bold />
                          </td>
                        )}
                        {!hiddenColumns.has("pnl") && (
                          <td className="py-1 pl-1.5 pr-2.5 text-right tabular-nums">
                            <SignedMoney cents={r.pnlCents} bold />
                          </td>
                        )}
                      </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-black/[0.08] bg-black/[0.015] font-semibold text-[#1d1d1f]">
                      <td className="py-1 pl-3 pr-1.5"></td>
                      {!hiddenColumns.has("reference") && <td className="py-1 pl-2.5 pr-1.5">Total ({sortedRows.length})</td>}
                      {!hiddenColumns.has("bookedAt") && <td className="py-1 px-1.5"></td>}
                      {!hiddenColumns.has("stay") && <td className="py-1 px-1.5"></td>}
                      {!hiddenColumns.has("platform") && <td className="py-1 px-1.5"></td>}
                      {!hiddenColumns.has("confirmationCode") && <td className="py-1 px-1.5"></td>}
                      {!hiddenColumns.has("gross") && (
                        <td className="py-1 px-1.5 text-right tabular-nums">
                          <Money cents={totals.grossCents} bold />
                        </td>
                      )}
                      {!hiddenColumns.has("cleaning") && (
                        <td className="py-1 px-1.5 text-right tabular-nums">
                          <Money cents={totals.cleaningFeeCents} bold />
                        </td>
                      )}
                      {!hiddenColumns.has("sum") && (
                        <td className="py-1 px-1.5 text-right tabular-nums">
                          <Money cents={totals.sumCents} bold />
                        </td>
                      )}
                      {!hiddenColumns.has("platformCommission") && (
                        <td className="py-1 px-1.5 text-right tabular-nums">
                          <Money cents={totals.platformCommissionCents} bold />
                        </td>
                      )}
                      {!hiddenColumns.has("effectivePercent") && <td className="py-1 px-1.5"></td>}
                      {!hiddenColumns.has("percentOnGrossOnly") && <td className="py-1 px-1.5"></td>}
                      {!hiddenColumns.has("commissionOnCleaning") && (
                        <td className="py-1 px-1.5 text-right tabular-nums text-[#0071e3]">
                          <Money cents={totals.commissionOnCleaningCents} bold />
                        </td>
                      )}
                      {!hiddenColumns.has("commissionPercent") && <td className="py-1 px-1.5"></td>}
                      {!hiddenColumns.has("additionalCommission") && (
                        <td className="py-1 px-1.5 text-right tabular-nums text-red-600">
                          <Money cents={totals.additionalCommissionCents} bold />
                        </td>
                      )}
                      {!hiddenColumns.has("pnl") && (
                        <td className="py-1 pl-1.5 pr-2.5 text-right tabular-nums">
                          <SignedMoney cents={totals.pnlCents} bold />
                        </td>
                      )}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {!rows && !loading && !error && (
        <p className="text-[13px] text-[#6e6e73]">Choisis une période, filtre par bien/tag si besoin, puis charge les données.</p>
      )}
    </div>
  );
}
