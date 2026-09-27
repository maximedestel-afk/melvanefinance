"use client";

import { useMemo, useState, type ReactNode } from "react";
import { fillRateBadgeStyle, formatEuros, formatPercent, MONTH_LABELS_SHORT } from "@/lib/format";
import type { PropertyMonthlyResult } from "@/lib/vrplatform";
import type { RentType } from "@/lib/types";
import { ExpenseDetailModal } from "./ExpenseDetailModal";
import { CalendarGrid, type CalendarDay } from "./CalendarGrid";

const RENT_TYPE_LABELS: Record<RentType, string> = {
  fixe: "Fixe",
  variable: "Variable",
  fixe_variable: "Fixe + variable",
};

// Le loyer (Owner) s'applique à toute part fixe — modèles Fixe et Fixe +
// variable. Le "Loyer fixe" façon Revenus, lui, ne s'applique qu'au modèle
// Fixe pur (isFixedRent côté serveur == rentType === "fixe").
const RENT_TYPES_WITH_LOYER: RentType[] = ["fixe", "fixe_variable"];

interface PropertyOption {
  id: string;
  reference: string;
  rentType: RentType | null;
}

interface CleaningApiResult {
  propertyId: string;
  checkoutDates: string[];
  cleaningFeeCustomField: number | null;
  cleaningFeeGuesty: number | null;
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

function SignedMoney({ cents, bold = false }: { cents: number | null; bold?: boolean }) {
  if (cents == null) return <span className="text-[#6e6e73]">—</span>;
  return (
    <span className={`${bold ? "font-semibold" : ""} ${cents >= 0 ? "text-emerald-600" : "text-red-600"}`}>
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

function StatTile({
  label,
  title,
  onClick,
  children,
}: {
  label: string;
  title?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  const content = (
    <>
      <div className="text-[11px] font-medium text-[#86868b]">{label}</div>
      <div className="mt-1 text-[16px] font-semibold text-[#1d1d1f]">{children}</div>
    </>
  );
  const className = `rounded-[12px] border border-black/[0.06] bg-white p-3 text-left ${
    onClick ? "cursor-pointer transition hover:border-[#0071e3]/40 hover:bg-[#0071e3]/5" : ""
  }`;
  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={title} className={className}>
        {content}
      </button>
    );
  }
  return (
    <div title={title} className={className}>
      {content}
    </div>
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

export function PropertyAnalysisTable({ properties: unsortedProperties }: { properties: PropertyOption[] }) {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 4 + i);
  const properties = useMemo(
    () => [...unsortedProperties].sort((a, b) => a.reference.localeCompare(b.reference, "fr")),
    [unsortedProperties]
  );

  const [propertyId, setPropertyId] = useState<string>(properties[0]?.id ?? "");
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [showPeriodPicker, setShowPeriodPicker] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [monthly, setMonthly] = useState<PropertyMonthlyResult | null>(null);
  const [cleaning, setCleaning] = useState<CleaningApiResult | null>(null);
  const [reservations, setReservations] = useState<ReservationDetail[] | null>(null);
  const [calendarDays, setCalendarDays] = useState<CalendarDay[] | null>(null);
  const [showExpenseDetail, setShowExpenseDetail] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("checkIn");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");

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
    setLoading(true);
    setError(null);
    setMonthly(null);
    setCleaning(null);
    setReservations(null);
    setCalendarDays(null);
    try {
      const monthlyParams = new URLSearchParams({ year: String(year), propertyIds: propertyId, includeExpenses: "1" });
      const cleaningParams = new URLSearchParams({ year: String(year), months: String(month), propertyIds: propertyId });
      const reservationsParams = new URLSearchParams({ propertyId, year: String(year), months: String(month) });
      const calendarParams = new URLSearchParams({ propertyId, year: String(year), month: String(month) });

      const [monthlyRes, cleaningRes, reservationsRes, calendarRes] = await Promise.all([
        fetch(`/api/finance/monthly?${monthlyParams.toString()}`),
        fetch(`/api/finance/cleaning?${cleaningParams.toString()}`),
        fetch(`/api/finance/reservations?${reservationsParams.toString()}`),
        fetch(`/api/finance/calendar?${calendarParams.toString()}`),
      ]);

      const monthlyData = await monthlyRes.json();
      if (monthlyData.error) {
        setError(monthlyData.error);
        return;
      }
      const property: PropertyMonthlyResult | undefined = monthlyData.properties?.[0];
      if (!property) {
        setError("Bien introuvable pour cette période.");
        return;
      }
      setMonthly(property);

      const cleaningData = await cleaningRes.json();
      setCleaning(cleaningData.error ? null : (cleaningData.properties?.[0] ?? null));

      const reservationsData = await reservationsRes.json();
      setReservations(reservationsData.error ? [] : reservationsData.reservations);

      const calendarData = await calendarRes.json();
      setCalendarDays(calendarData.error ? null : calendarData.days);
    } catch {
      setError("Impossible de charger les données.");
    } finally {
      setLoading(false);
    }
  }

  const rentType = properties.find((p) => p.id === propertyId)?.rentType ?? null;
  const monthData = monthly?.months.find((m) => m.month === month) ?? null;

  const figures = useMemo(() => {
    if (!monthly || !monthData) return null;

    const netCommissionableRevenueCents = monthData.netRevenueCents;
    const commissionCents =
      rentType !== "fixe" && monthly.commissionPercent != null
        ? Math.round((netCommissionableRevenueCents * monthly.commissionPercent) / 100)
        : null;
    const netRevenueAfterCommissionCents = netCommissionableRevenueCents - (commissionCents ?? 0);

    const loyerCents =
      rentType != null && RENT_TYPES_WITH_LOYER.includes(rentType) && monthly.fixedRentAmountCents != null
        ? monthly.fixedRentAmountCents
        : null;
    const excessCents = loyerCents != null ? netRevenueAfterCommissionCents - loyerCents : null;
    const avgGrossNightlyRateCents =
      monthData.checkoutNights > 0 ? Math.round(monthData.rentsCents / monthData.checkoutNights) : null;

    const fixedRentCents = monthly.isFixedRent && monthly.fixedRentAmountCents != null ? monthly.fixedRentAmountCents : null;
    const checkoutCount = cleaning?.checkoutDates.length ?? 0;
    const cleaningProductGuesty =
      cleaning?.cleaningFeeGuesty != null ? checkoutCount * cleaning.cleaningFeeGuesty : null;
    const cleaningProductCustom =
      cleaning?.cleaningFeeCustomField != null ? checkoutCount * cleaning.cleaningFeeCustomField : null;
    const cleaningProfitCents =
      cleaningProductGuesty != null && cleaningProductCustom != null
        ? Math.round((cleaningProductGuesty - cleaningProductCustom) * 100)
        : null;

    // Profit façon Revenus : (Commission, ou Net Revenue − Loyer fixe pour le
    // modèle Fixe pur) + City Tax + Profit ménage.
    const baseProfitCents = monthly.isFixedRent
      ? fixedRentCents != null
        ? netRevenueAfterCommissionCents - fixedRentCents
        : null
      : commissionCents;
    const profitCents =
      baseProfitCents != null ? baseProfitCents + monthData.cityTaxCents + (cleaningProfitCents ?? 0) : null;

    return {
      netCommissionableRevenueCents,
      commissionCents,
      netRevenueAfterCommissionCents,
      loyerCents,
      excessCents,
      avgGrossNightlyRateCents,
      fixedRentCents,
      cleaningProfitCents,
      profitCents,
    };
  }, [monthly, monthData, cleaning, rentType]);

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

  const periodSummary = `${MONTH_LABELS_SHORT[month - 1]} ${year}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <label className="field-label" htmlFor="analysis-property">
            Bien
          </label>
          <select
            id="analysis-property"
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            className="mt-1 rounded-[10px] border border-black/10 bg-white px-3 py-2 text-[14px] text-[#1d1d1f] shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus:border-[#0071e3] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
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
                <label className="field-label" htmlFor="analysis-year">
                  Année
                </label>
                <select
                  id="analysis-year"
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
          {loading ? "Chargement…" : monthly ? "Actualiser" : "Charger"}
        </button>
      </div>

      {error && <p className="text-[13px] text-red-600">{error}</p>}

      {monthly && monthData && figures && !loading && !error && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[16px] font-semibold text-[#1d1d1f]">
              {monthly.reference} — {MONTH_LABELS_SHORT[month - 1]} {year}
            </h3>
            <span className="rounded-full bg-[#0071e3]/10 px-2.5 py-1 text-[12px] font-medium text-[#0071e3]">
              {rentType != null ? RENT_TYPE_LABELS[rentType] : "Modèle inconnu"}
            </span>
            {monthly.notFoundReferences.length > 0 && (
              <span title={`Référence VRPlatform introuvable : ${monthly.notFoundReferences.join(", ")}`} className="text-amber-600">
                ⚠
              </span>
            )}
          </div>

          <div>
            <p className="mb-2 text-[12px] font-medium text-[#6e6e73]">Owner</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-8">
              <StatTile label="TR">
                <span
                  className="inline-block rounded-full px-2 py-0.5 text-[13px] font-medium tabular-nums"
                  style={fillRateBadgeStyle(monthData.fillRate)}
                >
                  {formatPercent(monthData.fillRate)}
                </span>
              </StatTile>
              <StatTile label="Net Comm. Revenue" title="Net Commissionable Revenue">
                <Money cents={figures.netCommissionableRevenueCents} />
              </StatTile>
              <StatTile label="Commission">
                <Money cents={figures.commissionCents} />
                {figures.commissionCents != null && monthly.commissionPercent != null && (
                  <span className="ml-1 text-[11px] font-normal text-[#86868b]">({monthly.commissionPercent}%)</span>
                )}
              </StatTile>
              <StatTile
                label="Expenses"
                title="Operating & Maintenance Expenses + Adjustments + Processing Fees (configuration du owner statement VRPlatform) — cliquer pour le détail"
                onClick={() => setShowExpenseDetail(true)}
              >
                <Money cents={monthData.expensesCents} />
              </StatTile>
              <StatTile label="Net Revenue">
                <Money cents={figures.netRevenueAfterCommissionCents} bold />
              </StatTile>
              <StatTile label="Loyer">
                <Money cents={figures.loyerCents} />
              </StatTile>
              <StatTile label="Excess">
                <SignedMoney cents={figures.excessCents} bold />
              </StatTile>
              <StatTile label="Prix moyen brut/nuit" title="Rents ÷ nuits, avant déduction des Channel Fees">
                <Money cents={figures.avgGrossNightlyRateCents} />
              </StatTile>
            </div>
          </div>

          <div>
            <p className="mb-2 text-[12px] font-medium text-[#6e6e73]">Revenus</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              <StatTile label="Rents">
                <Money cents={monthData.rentsCents} />
              </StatTile>
              <StatTile label="Channel Fees">
                <Money cents={monthData.channelFeesCents} />
              </StatTile>
              <StatTile label="City Tax">
                <Money cents={monthData.cityTaxCents} />
              </StatTile>
              <StatTile label="Transfer Fees">
                <Money cents={monthData.transferFeesCents} />
              </StatTile>
              <StatTile label="Ménage" title="(Prix client − coût prestataire) × nombre de check-out">
                <SignedMoney cents={figures.cleaningProfitCents} bold />
              </StatTile>
              <StatTile label="Loyer fixe" title="Loyer fixe, uniquement pour le modèle Fixe pur">
                <Money cents={figures.fixedRentCents} />
              </StatTile>
              <StatTile label="Profit" title="(Commission, ou Net Revenue − Loyer fixe) + City Tax + Profit ménage">
                <SignedMoney cents={figures.profitCents} bold />
              </StatTile>
            </div>
          </div>

          <div>
            <p className="mb-2 text-[12px] font-medium text-[#6e6e73]">Calendrier</p>
            {calendarDays ? (
              <div className="max-w-[480px] rounded-[14px] border border-black/[0.06] bg-white p-3.5">
                <CalendarGrid days={calendarDays} />
              </div>
            ) : (
              <p className="text-[13px] text-[#6e6e73]">Calendrier indisponible.</p>
            )}
          </div>

          <div>
            <p className="mb-2 text-[12px] font-medium text-[#6e6e73]">Réservations</p>
            {sortedReservations && sortedReservations.length > 0 ? (
              <div className="overflow-hidden rounded-[14px] border border-black/[0.06]">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[12px]">
                    <thead>
                      <tr className="border-b border-black/[0.08] bg-black/[0.015]">
                        <th className="py-1.5 pl-3 pr-2 text-left text-[11px] font-medium text-[#86868b]">Voyageur</th>
                        <SortHeader label="Date résa" sortKey="bookedAt" activeKey={sortKey} direction={direction} onSort={handleSort} />
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
                        <SortHeader label="Commission" sortKey="commission" activeKey={sortKey} direction={direction} onSort={handleSort} narrow />
                        <SortHeader label="Expenses" sortKey="expenses" activeKey={sortKey} direction={direction} onSort={handleSort} narrow />
                        <SortHeader label="Net Revenue" sortKey="netRevenue" activeKey={sortKey} direction={direction} onSort={handleSort} narrow />
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
                  </table>
                </div>
              </div>
            ) : (
              <p className="text-[13px] text-[#6e6e73]">Aucune réservation sur ce mois.</p>
            )}
          </div>
        </div>
      )}

      {!monthly && !loading && !error && (
        <p className="text-[13px] text-[#6e6e73]">Choisis un bien, un mois et une année, puis charge les données.</p>
      )}

      {showExpenseDetail && monthly && (
        <ExpenseDetailModal
          propertyId={monthly.propertyId}
          propertyLabel={monthly.reference}
          year={year}
          months={[month]}
          onClose={() => setShowExpenseDetail(false)}
        />
      )}
    </div>
  );
}
