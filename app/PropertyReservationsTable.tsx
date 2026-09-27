"use client";

import { useMemo, useState } from "react";
import { fillRateBadgeStyle, formatEuros, formatPercent, MONTH_LABELS_SHORT } from "@/lib/format";

interface PropertyOption {
  id: string;
  reference: string;
}

interface ReservationDetail {
  reservationId: string;
  checkIn: string;
  checkOut: string;
  bookedAt: string | null;
  nights: number;
  guestName: string | null;
  confirmationCode: string | null;
  bookingPlatform: string | null;
  grossNightlyRateCents: number | null;
  netCommissionableRevenueCents: number;
  commissionCents: number;
  expensesCents: number;
  netRevenueCents: number;
  /** Taux d'occupation du mois de check-out de la réservation (onglet
   * Remplissage), pas propre à la réservation elle-même. */
  occupancyRateOfMonth: number | null;
}

type SortKey =
  | "bookedAt"
  | "checkIn"
  | "nights"
  | "grossNightlyRate"
  | "netCommissionableRevenue"
  | "commission"
  | "expenses"
  | "netRevenue"
  | "occupancyRateOfMonth";

function Money({ cents, bold = false }: { cents: number | null; bold?: boolean }) {
  if (cents == null) return <span className="text-[#6e6e73]">—</span>;
  return <span className={bold ? "font-semibold" : undefined}>{formatEuros(cents / 100)}</span>;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "2-digit", timeZone: "UTC" });
}

function OccupancyBadge({ fillRate }: { fillRate: number | null }) {
  if (fillRate == null) return <span className="text-[#6e6e73]">—</span>;
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums"
      style={fillRateBadgeStyle(fillRate)}
    >
      {formatPercent(fillRate)}
    </span>
  );
}

function SortHeader({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
  align = "right",
  title,
  narrow = false,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  direction: "asc" | "desc";
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
  title?: string;
  narrow?: boolean;
}) {
  const isActive = activeKey === sortKey;
  return (
    <th className={`py-1.5 px-2 first:pl-3 last:pr-3 ${align === "right" ? "text-right" : "text-left"}`} title={title}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 text-[11px] font-medium transition ${
          align === "right" ? "flex-row-reverse" : ""
        } ${narrow ? "w-16 whitespace-normal text-left leading-tight" : ""} ${
          isActive ? "text-[#1d1d1f]" : "text-[#86868b] hover:text-[#1d1d1f]"
        }`}
      >
        {label}
        {isActive && <span aria-hidden>{direction === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}

export function PropertyReservationsTable({ properties: unsortedProperties }: { properties: PropertyOption[] }) {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 4 + i);
  const properties = useMemo(
    () => [...unsortedProperties].sort((a, b) => a.reference.localeCompare(b.reference, "fr")),
    [unsortedProperties]
  );

  const [propertyId, setPropertyId] = useState<string>(properties[0]?.id ?? "");
  const [year, setYear] = useState(currentYear);
  const [selectedMonths, setSelectedMonths] = useState<number[]>([new Date().getMonth() + 1]);
  const [showPeriodPicker, setShowPeriodPicker] = useState(false);
  const [reservations, setReservations] = useState<ReservationDetail[] | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("checkIn");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");

  function toggleMonth(month: number) {
    setSelectedMonths((prev) =>
      prev.includes(month) ? prev.filter((m) => m !== month) : [...prev, month].sort((a, b) => a - b)
    );
  }

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDirection(key === "checkIn" || key === "bookedAt" ? "asc" : "desc");
    }
  }

  async function load() {
    if (!propertyId) {
      setError("Choisis un bien.");
      return;
    }
    if (selectedMonths.length === 0) {
      setError("Sélectionne au moins un mois.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ propertyId, year: String(year), months: selectedMonths.join(",") });
      const res = await fetch(`/api/finance/reservations?${params.toString()}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setReservations(null);
      } else {
        setReservations(data.reservations);
        setReference(data.reference);
      }
    } catch {
      setError("Impossible de charger les réservations.");
    } finally {
      setLoading(false);
    }
  }

  const sortedReservations = reservations
    ? [...reservations].sort((a, b) => {
        let cmp: number;
        switch (sortKey) {
          case "bookedAt":
            cmp = (a.bookedAt ?? "").localeCompare(b.bookedAt ?? "");
            break;
          case "checkIn":
            cmp = a.checkIn.localeCompare(b.checkIn);
            break;
          case "nights":
            cmp = a.nights - b.nights;
            break;
          case "grossNightlyRate":
            cmp = (a.grossNightlyRateCents ?? 0) - (b.grossNightlyRateCents ?? 0);
            break;
          case "netCommissionableRevenue":
            cmp = a.netCommissionableRevenueCents - b.netCommissionableRevenueCents;
            break;
          case "commission":
            cmp = a.commissionCents - b.commissionCents;
            break;
          case "expenses":
            cmp = a.expensesCents - b.expensesCents;
            break;
          case "netRevenue":
            cmp = a.netRevenueCents - b.netRevenueCents;
            break;
          case "occupancyRateOfMonth":
            cmp = (a.occupancyRateOfMonth ?? 0) - (b.occupancyRateOfMonth ?? 0);
            break;
        }
        return direction === "asc" ? cmp : -cmp;
      })
    : null;

  const totals = sortedReservations
    ? {
        nights: sortedReservations.reduce((sum, r) => sum + r.nights, 0),
        rentsForAvgCents: sortedReservations.reduce((sum, r) => sum + (r.grossNightlyRateCents ?? 0) * r.nights, 0),
        netCommissionableRevenueCents: sortedReservations.reduce((sum, r) => sum + r.netCommissionableRevenueCents, 0),
        commissionCents: sortedReservations.reduce((sum, r) => sum + r.commissionCents, 0),
        expensesCents: sortedReservations.reduce((sum, r) => sum + r.expensesCents, 0),
        netRevenueCents: sortedReservations.reduce((sum, r) => sum + r.netRevenueCents, 0),
      }
    : null;
  const avgGrossNightlyRateCents = totals && totals.nights > 0 ? Math.round(totals.rentsForAvgCents / totals.nights) : null;

  const periodSummary =
    selectedMonths.length === 0
      ? "Aucun mois"
      : selectedMonths.length === 12
        ? `Année complète ${year}`
        : `${selectedMonths.map((m) => MONTH_LABELS_SHORT[m - 1]).join(", ")} ${year}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <label className="field-label" htmlFor="res-property">
            Bien
          </label>
          <select
            id="res-property"
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            className="mt-1 rounded-[10px] border-2 border-[#0071e3] bg-white px-3 py-[7px] text-[14px] font-medium text-[#0071e3] shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
          >
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.reference}
              </option>
            ))}
          </select>
        </div>

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
                <label className="field-label" htmlFor="res-year">
                  Année
                </label>
                <select
                  id="res-year"
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
          {loading ? "Chargement…" : reservations ? "Actualiser" : "Charger"}
        </button>
      </div>

      {error && <p className="text-[13px] text-red-600">{error}</p>}

      {sortedReservations && totals && !loading && !error && (
        <div className="space-y-2">
          <p className="text-[13px] text-[#6e6e73]">
            {sortedReservations.length} réservation{sortedReservations.length !== 1 ? "s" : ""} — {reference}
          </p>

          {sortedReservations.length === 0 ? (
            <p className="text-[13px] text-[#6e6e73]">Aucune réservation sur cette période.</p>
          ) : (
            <div className="overflow-hidden rounded-[14px] border border-black/[0.06]">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr className="border-b border-black/[0.08] bg-black/[0.015]">
                      <th className="py-1.5 pl-3 pr-2 text-left text-[11px] font-medium text-[#86868b]">Voyageur</th>
                      <SortHeader
                        label="Date résa"
                        sortKey="bookedAt"
                        activeKey={sortKey}
                        direction={direction}
                        onSort={handleSort}
                      />
                      <SortHeader label="Séjour" sortKey="checkIn" activeKey={sortKey} direction={direction} onSort={handleSort} />
                      <SortHeader
                        label="TO"
                        sortKey="occupancyRateOfMonth"
                        activeKey={sortKey}
                        direction={direction}
                        onSort={handleSort}
                        title="TO du mois de la réservation"
                      />
                      <SortHeader label="Nuits" sortKey="nights" activeKey={sortKey} direction={direction} onSort={handleSort} />
                      <SortHeader
                        label="Prix brut/nuit"
                        sortKey="grossNightlyRate"
                        activeKey={sortKey}
                        direction={direction}
                        onSort={handleSort}
                        narrow
                      />
                      <SortHeader
                        label="Net Comm. Revenue"
                        sortKey="netCommissionableRevenue"
                        activeKey={sortKey}
                        direction={direction}
                        onSort={handleSort}
                        narrow
                      />
                      <SortHeader
                        label="Commission"
                        sortKey="commission"
                        activeKey={sortKey}
                        direction={direction}
                        onSort={handleSort}
                        narrow
                      />
                      <SortHeader
                        label="Expenses"
                        sortKey="expenses"
                        activeKey={sortKey}
                        direction={direction}
                        onSort={handleSort}
                        narrow
                      />
                      <SortHeader
                        label="Net Revenue"
                        sortKey="netRevenue"
                        activeKey={sortKey}
                        direction={direction}
                        onSort={handleSort}
                        narrow
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedReservations.map((r, rowIndex) => (
                      <tr
                        key={r.reservationId}
                        className={`border-b border-black/[0.04] transition-colors last:border-b-0 hover:bg-[#dceafb] ${
                          rowIndex % 2 === 0 ? "bg-white" : "bg-[#f0f6fd]"
                        }`}
                      >
                        <td className="py-1.5 pl-3 pr-2 text-[#1d1d1f]">
                          <div className="font-medium">{r.guestName ?? "Voyageur inconnu"}</div>
                          <div className="text-[10.5px] text-[#86868b]">
                            {r.bookingPlatform ?? ""}
                            {r.confirmationCode ? ` · ${r.confirmationCode}` : ""}
                          </div>
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">{formatDate(r.bookedAt)}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">
                          {formatDate(r.checkIn)} → {formatDate(r.checkOut)}
                        </td>
                        <td className="py-1.5 px-2 text-right">
                          <OccupancyBadge fillRate={r.occupancyRateOfMonth} />
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">{r.nights}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">
                          <Money cents={r.grossNightlyRateCents} />
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">
                          <Money cents={r.netCommissionableRevenueCents} />
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">
                          <Money cents={r.commissionCents} />
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">
                          <Money cents={r.expensesCents} />
                        </td>
                        <td className="py-1.5 pl-2 pr-3 text-right tabular-nums font-semibold text-[#1d1d1f]">
                          <Money cents={r.netRevenueCents} bold />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-black/[0.08] bg-black/[0.015] font-semibold text-[#1d1d1f]">
                      <td className="py-1.5 pl-3 pr-2">Total ({sortedReservations.length})</td>
                      <td className="py-1.5 px-2"></td>
                      <td className="py-1.5 px-2"></td>
                      <td className="py-1.5 px-2"></td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{totals.nights}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">
                        <Money cents={avgGrossNightlyRateCents} bold />
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums">
                        <Money cents={totals.netCommissionableRevenueCents} bold />
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums">
                        <Money cents={totals.commissionCents} bold />
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums">
                        <Money cents={totals.expensesCents} bold />
                      </td>
                      <td className="py-1.5 pl-2 pr-3 text-right tabular-nums">
                        <Money cents={totals.netRevenueCents} bold />
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {!reservations && !loading && !error && (
        <p className="text-[13px] text-[#6e6e73]">Choisis un bien, une année et un ou plusieurs mois, puis charge les données.</p>
      )}
    </div>
  );
}
