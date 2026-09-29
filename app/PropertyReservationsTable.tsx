"use client";

import { useMemo, useState } from "react";
import { fillRateBadgeStyle, formatEuros, formatPercent, MONTH_LABELS_SHORT } from "@/lib/format";
import type { RentType } from "@/lib/types";

const RENT_TYPE_LABELS: Record<RentType, string> = {
  fixe: "Fixe",
  variable: "Variable",
  fixe_variable: "Fixe + variable",
};

interface PropertyOption {
  id: string;
  reference: string;
  tags: string[];
  rentType: RentType | null;
}

interface BookingWindowStats {
  sampleSize: number;
  medianLeadTimeDays: number | null;
  avgLengthOfStayNights: number | null;
}

interface ReservationDetail {
  propertyId: string;
  reference: string;
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
  /** City Tax de cette réservation — entre dans le Profit Melvane, pas dans
   * le Net Revenue/Profit propriétaire. */
  cityTaxCents: number;
  /** Transfer Fees de cette réservation — entre aussi dans le Profit
   * Melvane. */
  transferFeesCents: number;
  /** Prix ménage facturé au client − coût prestataire (constant par bien,
   * un check-out = un ménage) — entre dans le Profit Melvane. null si
   * Guesty n'est pas configuré ou indisponible pour ce bien. */
  cleaningProfitCents: number | null;
  /** Taux d'occupation du mois de check-out de la réservation, sur son
   * propre bien (onglet Remplissage) — pas propre à la réservation. */
  occupancyRateOfMonth: number | null;
}

type SortKey =
  | "reference"
  | "bookedAt"
  | "checkIn"
  | "nights"
  | "grossNightlyRate"
  | "netCommissionableRevenue"
  | "commission"
  | "expenses"
  | "netRevenue"
  | "cleaningProfit"
  | "profitMelvane"
  | "occupancyRateOfMonth";

/** Profit Melvane d'une réservation = Commission + City Tax + Transfer Fees
 * + Profit ménage — même base que la tuile "Profit" de l'onglet Analyse/
 * Revenus, ramenée à l'échelle d'une réservation, plus les Transfer Fees. */
function profitMelvaneCents(r: ReservationDetail): number {
  return r.commissionCents + r.cityTaxCents + r.transferFeesCents + (r.cleaningProfitCents ?? 0);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function Money({ cents, bold = false }: { cents: number | null; bold?: boolean }) {
  if (cents == null) return <span className="text-[#6e6e73]">—</span>;
  return <span className={bold ? "font-semibold" : undefined}>{formatEuros(cents / 100)}</span>;
}

function SignedMoney({ cents }: { cents: number | null }) {
  if (cents == null) return <span className="text-[#6e6e73]">—</span>;
  return (
    <span className={cents >= 0 ? "text-emerald-600" : "text-red-600"}>
      {cents >= 0 ? "+" : ""}
      {formatEuros(cents / 100)}
    </span>
  );
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

/** Mêmes filtres (biens/modèle de rémunération/tags) et même agencement que
 * l'onglet Revenus (PropertyFinanceTable) — sélection multi-biens, dont les
 * réservations sont fusionnées dans un seul tableau (colonne "Bien" pour
 * les distinguer). */
export function PropertyReservationsTable({ properties: unsortedProperties }: { properties: PropertyOption[] }) {
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
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedRentTypes, setSelectedRentTypes] = useState<RentType[]>([]);
  const [reservations, setReservations] = useState<ReservationDetail[] | null>(null);
  const [bookingWindow, setBookingWindow] = useState<BookingWindowStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("checkIn");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");

  const matchingProperties = useMemo(() => {
    return allProperties.filter((p) => {
      const isSelected = selectedPropertyIds.includes(p.id);
      const matchesTags = selectedTags.length === 0 || p.tags.some((t) => selectedTags.includes(t));
      const matchesRentType = selectedRentTypes.length === 0 || (p.rentType != null && selectedRentTypes.includes(p.rentType));
      return isSelected && matchesTags && matchesRentType;
    });
  }, [allProperties, selectedPropertyIds, selectedTags, selectedRentTypes]);

  function toggleMonth(month: number) {
    setSelectedMonths((prev) =>
      prev.includes(month) ? prev.filter((m) => m !== month) : [...prev, month].sort((a, b) => a - b)
    );
  }

  function toggleProperty(id: string) {
    setSelectedPropertyIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  function toggleTag(tag: string) {
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  function toggleRentType(rentType: RentType) {
    setSelectedRentTypes((prev) => (prev.includes(rentType) ? prev.filter((t) => t !== rentType) : [...prev, rentType]));
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
      const propertyIds = matchingProperties.map((p) => p.id).join(",");
      const params = new URLSearchParams({ propertyIds, year: String(year), months: selectedMonths.join(",") });
      const bookingWindowParams = new URLSearchParams({ propertyIds });
      const [res, bookingWindowRes] = await Promise.all([
        fetch(`/api/finance/reservations-portfolio?${params.toString()}`),
        fetch(`/api/finance/booking-window-portfolio?${bookingWindowParams.toString()}`),
      ]);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setReservations(null);
      } else {
        setReservations(data.reservations);
      }
      // Donnée de contexte (12 derniers mois glissants, indépendante de la
      // période sélectionnée) : une erreur ici n'empêche pas d'afficher le
      // reste du tableau. Agrégée (médiane/moyenne) sur les biens
      // sélectionnés, comme les autres onglets portefeuille.
      const bookingWindowData = await bookingWindowRes.json();
      if (bookingWindowData.error) {
        setBookingWindow(null);
      } else {
        const stats: { sampleSize: number; medianLeadTimeDays: number | null; avgLengthOfStayNights: number | null }[] =
          bookingWindowData.properties ?? [];
        setBookingWindow({
          sampleSize: stats.reduce((sum, s) => sum + s.sampleSize, 0),
          medianLeadTimeDays: median(stats.map((s) => s.medianLeadTimeDays).filter((v): v is number => v != null)),
          avgLengthOfStayNights: average(stats.map((s) => s.avgLengthOfStayNights).filter((v): v is number => v != null)),
        });
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
          case "reference":
            cmp = a.reference.localeCompare(b.reference, "fr");
            break;
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
          case "cleaningProfit":
            cmp = (a.cleaningProfitCents ?? 0) - (b.cleaningProfitCents ?? 0);
            break;
          case "profitMelvane":
            cmp = profitMelvaneCents(a) - profitMelvaneCents(b);
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
        cleaningProfitCents: sortedReservations.reduce((sum, r) => sum + (r.cleaningProfitCents ?? 0), 0),
        profitMelvaneCents: sortedReservations.reduce((sum, r) => sum + profitMelvaneCents(r), 0),
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

      <div>
        <span className="field-label">Modèle de rémunération</span>
        <div className="mt-1 flex flex-wrap gap-1">
          {(Object.keys(RENT_TYPE_LABELS) as RentType[]).map((rentType) => {
            const active = selectedRentTypes.includes(rentType);
            return (
              <button
                key={rentType}
                type="button"
                onClick={() => toggleRentType(rentType)}
                className={`rounded-full border px-2.5 py-1 text-[13px] font-medium transition ${
                  active
                    ? "border-[#0071e3] bg-[#0071e3] text-white"
                    : "border-black/10 bg-white text-[#1d1d1f] hover:bg-black/[0.04]"
                }`}
              >
                {RENT_TYPE_LABELS[rentType]}
              </button>
            );
          })}
        </div>
      </div>

      {allTags.length > 0 && (
        <div>
          <span className="field-label">Tags</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {allTags.map((tag) => {
              const active = selectedTags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={`rounded-full border px-2.5 py-1 text-[13px] font-medium transition ${
                    active
                      ? "border-[#0071e3] bg-[#0071e3] text-white"
                      : "border-black/10 bg-white text-[#1d1d1f] hover:bg-black/[0.04]"
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {error && <p className="text-[13px] text-red-600">{error}</p>}

      {sortedReservations && totals && !loading && !error && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[13px] text-[#6e6e73]">
              {sortedReservations.length} réservation{sortedReservations.length !== 1 ? "s" : ""}
            </p>
            {bookingWindow && (
              <span
                className="rounded-full bg-[#0071e3]/10 px-3 py-1 text-[12px] font-medium text-[#0071e3]"
                title="Médiane/moyenne sur les biens sélectionnés, réservations faites au cours des 12 derniers mois glissants (indépendant de la période sélectionnée ci-dessus)."
              >
                Fenêtre de résa médiane (12 mois) :{" "}
                {bookingWindow.medianLeadTimeDays != null ? `${Math.round(bookingWindow.medianLeadTimeDays)} j` : "—"}
                {" · Séjour moyen : "}
                {bookingWindow.avgLengthOfStayNights != null ? `${bookingWindow.avgLengthOfStayNights.toFixed(1)} nuits` : "—"}
              </span>
            )}
          </div>

          {sortedReservations.length === 0 ? (
            <p className="text-[13px] text-[#6e6e73]">Aucune réservation sur cette période.</p>
          ) : (
            <div className="overflow-hidden rounded-[14px] border border-black/[0.06]">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr className="border-b border-black/[0.08] bg-black/[0.015]">
                      <th className="py-1.5 pl-3 pr-2 text-left text-[11px] font-medium text-[#86868b]">Voyageur</th>
                      <SortHeader label="Bien" sortKey="reference" activeKey={sortKey} direction={direction} onSort={handleSort} align="left" />
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
                      <SortHeader
                        label="Profit propriétaire"
                        sortKey="netRevenue"
                        activeKey={sortKey}
                        direction={direction}
                        onSort={handleSort}
                        title="Net Commissionable Revenue − Commission — même formule que « Net Revenue » (Analyse/Revenus)"
                        narrow
                      />
                      <SortHeader
                        label="Ménage"
                        sortKey="cleaningProfit"
                        activeKey={sortKey}
                        direction={direction}
                        onSort={handleSort}
                        title="Prix ménage facturé au client − coût prestataire"
                        narrow
                      />
                      <SortHeader
                        label="Profit Melvane"
                        sortKey="profitMelvane"
                        activeKey={sortKey}
                        direction={direction}
                        onSort={handleSort}
                        title="Commission + City Tax + Transfer Fees + Profit ménage"
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
                        <td className="py-1.5 px-2 text-left font-medium text-[#1d1d1f]">{r.reference}</td>
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
                        <td className="py-1.5 px-2 text-right tabular-nums font-semibold text-[#1d1d1f]">
                          <Money cents={r.netRevenueCents} bold />
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums font-semibold text-[#1d1d1f]">
                          <Money cents={r.netRevenueCents} bold />
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums font-semibold">
                          <SignedMoney cents={r.cleaningProfitCents} />
                        </td>
                        <td className="py-1.5 pl-2 pr-3 text-right tabular-nums font-semibold text-[#1d1d1f]">
                          <Money cents={profitMelvaneCents(r)} bold />
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
                      <td className="py-1.5 px-2 text-right tabular-nums">
                        <Money cents={totals.netRevenueCents} bold />
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums">
                        <Money cents={totals.netRevenueCents} bold />
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums">
                        <SignedMoney cents={totals.cleaningProfitCents} />
                      </td>
                      <td className="py-1.5 pl-2 pr-3 text-right tabular-nums">
                        <Money cents={totals.profitMelvaneCents} bold />
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
        <p className="text-[13px] text-[#6e6e73]">
          Choisis une année, un ou plusieurs mois, filtre par bien/modèle/tag si besoin, puis charge les données.
        </p>
      )}
    </div>
  );
}
