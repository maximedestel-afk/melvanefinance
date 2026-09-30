"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { addDaysIso, fillRateBadgeStyle, formatEuros, formatPercent, MONTH_LABELS_SHORT, todayIso } from "@/lib/format";
import type { PropertyMonthlyResult, PropertyRangeResult } from "@/lib/vrplatform";
import type { RentType } from "@/lib/types";
import { ExpenseDetailModal } from "./ExpenseDetailModal";
import { CalendarGrid, type CalendarDay } from "./CalendarGrid";
import { DailyPriceChart } from "./DailyPriceChart";

const RENT_TYPE_LABELS: Record<RentType, string> = {
  fixe: "Fixe",
  variable: "Variable",
  fixe_variable: "Fixe + variable",
};

// Le loyer (Owner) s'applique à toute part fixe — modèles Fixe et Fixe +
// variable. Le "Loyer fixe" façon Revenus, lui, ne s'applique qu'au modèle
// Fixe pur (isFixedRent côté serveur == rentType === "fixe").
const RENT_TYPES_WITH_LOYER: RentType[] = ["fixe", "fixe_variable"];

// Prix affiché sur le calendrier (et "Prix moyen brut/nuit") = équivalent
// Rents, avant déduction de la commission de la plateforme (Airbnb,
// Booking...). Pour une nuit pas encore vendue, on ne connaît ni le canal ni
// la commission réelle, donc on utilise un taux de référence.
const CHANNEL_FEE_RATE_REFERENCE = 0.17;

// On ne peut pas viser 100% de remplissage sur les nuits encore libres — on
// vise un objectif de remplissage raisonnable du mois (nuits bloquées
// exclues, même base que le TR affiché plus haut).
const TARGET_FILL_RATE = 0.8;

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

interface BookingWindowStats {
  sampleSize: number;
  medianLeadTimeDays: number | null;
  avgLengthOfStayNights: number | null;
  leadTimeBuckets: {
    under7Percent: number | null;
    from7To15Percent: number | null;
    over15Percent: number | null;
  };
}

/** Sous-ensemble commun à PropertyMonthlyResult et PropertyRangeResult,
 * utilisé pour piloter les calculs (figures) indépendamment du mode. */
interface PropertyMetaCommon {
  propertyId: string;
  reference: string;
  name: string | null;
  isFixedRent: boolean;
  fixedRentAmountCents: number | null;
  commissionPercent: number | null;
  notFoundReferences: string[];
}

/** Sous-ensemble commun à MonthlyFinance et RangeFinance. */
interface FinanceFiguresCommon {
  rentsCents: number;
  channelFeesCents: number;
  cityTaxCents: number;
  transferFeesCents: number;
  expensesCents: number;
  netRevenueCents: number;
  checkoutNights: number;
  fillRate: number;
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
  | "ownerNet"
  | "occupancyRateOfMonth";

function Money({ cents, bold = false }: { cents: number | null; bold?: boolean }) {
  if (cents == null) return <span className="text-[#6e6e73]">—</span>;
  return <span className={bold ? "font-semibold" : undefined}>{formatEuros(cents / 100)}</span>;
}

/** "Owner Net" par réservation = "Owner Gross" (netRevenueCents) − Expenses
 * attribuées à cette réservation. */
function reservationOwnerNetCents(r: { netRevenueCents: number; expensesCents: number }): number {
  return r.netRevenueCents - r.expensesCents;
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

type AnalysisRequest =
  | { propertyId: string; year: number; month: number; token: number }
  | { propertyId: string; startDate: string; endDate: string; token: number };

export function PropertyAnalysisTable({
  properties: unsortedProperties,
  request,
}: {
  properties: PropertyOption[];
  /** Navigation depuis un autre onglet (ex: clic sur le TR dans Owner, ou sur
   * un bien dans Tendances pour les 30 prochains jours) — un nouveau `token`
   * force la sélection et le chargement même si les autres champs sont
   * identiques à la demande précédente. */
  request?: AnalysisRequest | null;
}) {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 4 + i);
  const properties = useMemo(
    () => [...unsortedProperties].sort((a, b) => a.reference.localeCompare(b.reference, "fr")),
    [unsortedProperties]
  );

  const requestIsRange = request != null && "startDate" in request;

  const [mode, setMode] = useState<"month" | "range">(requestIsRange ? "range" : "month");
  const [propertyId, setPropertyId] = useState<string>(request?.propertyId ?? properties[0]?.id ?? "");
  const [year, setYear] = useState(request != null && "year" in request ? request.year : currentYear);
  const [month, setMonth] = useState(request != null && "month" in request ? request.month : new Date().getMonth() + 1);
  const [rangeStart, setRangeStart] = useState<string>(
    request != null && "startDate" in request ? request.startDate : todayIso()
  );
  const [rangeEnd, setRangeEnd] = useState<string>(
    request != null && "endDate" in request ? request.endDate : addDaysIso(todayIso(), 29)
  );
  const [showPeriodPicker, setShowPeriodPicker] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [monthly, setMonthly] = useState<PropertyMonthlyResult | null>(null);
  const [rangeResult, setRangeResult] = useState<PropertyRangeResult | null>(null);
  const [cleaning, setCleaning] = useState<CleaningApiResult | null>(null);
  const [reservations, setReservations] = useState<ReservationDetail[] | null>(null);
  const [calendarDays, setCalendarDays] = useState<CalendarDay[] | null>(null);
  const [bookingWindow, setBookingWindow] = useState<BookingWindowStats | null>(null);
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

  async function load(overrideRequest?: AnalysisRequest) {
    const targetPropertyId = overrideRequest?.propertyId ?? propertyId;
    const targetMode: "month" | "range" = overrideRequest ? (("startDate" in overrideRequest) ? "range" : "month") : mode;
    const targetYear = overrideRequest != null && "year" in overrideRequest ? overrideRequest.year : year;
    const targetMonth = overrideRequest != null && "month" in overrideRequest ? overrideRequest.month : month;
    const targetStart = overrideRequest != null && "startDate" in overrideRequest ? overrideRequest.startDate : rangeStart;
    const targetEnd = overrideRequest != null && "endDate" in overrideRequest ? overrideRequest.endDate : rangeEnd;
    if (!targetPropertyId) {
      setError("Choisis un bien.");
      return;
    }
    setLoading(true);
    setError(null);
    setMonthly(null);
    setRangeResult(null);
    setCleaning(null);
    setReservations(null);
    setCalendarDays(null);
    setBookingWindow(null);
    try {
      const bookingWindowParams = new URLSearchParams({ propertyId: targetPropertyId });

      if (targetMode === "range") {
        const rangeParams = new URLSearchParams({
          startDate: targetStart,
          endDate: targetEnd,
          propertyIds: targetPropertyId,
          includeExpenses: "1",
        });
        const cleaningParams = new URLSearchParams({
          startDate: targetStart,
          endDate: targetEnd,
          propertyIds: targetPropertyId,
        });
        const reservationsParams = new URLSearchParams({
          propertyId: targetPropertyId,
          startDate: targetStart,
          endDate: targetEnd,
        });
        const calendarParams = new URLSearchParams({
          propertyId: targetPropertyId,
          startDate: targetStart,
          endDate: targetEnd,
        });

        const [rangeRes, cleaningRes, reservationsRes, calendarRes, bookingWindowRes] = await Promise.all([
          fetch(`/api/finance/range?${rangeParams.toString()}`),
          fetch(`/api/finance/cleaning-range?${cleaningParams.toString()}`),
          fetch(`/api/finance/reservations-range?${reservationsParams.toString()}`),
          fetch(`/api/finance/calendar?${calendarParams.toString()}`),
          fetch(`/api/finance/booking-window?${bookingWindowParams.toString()}`),
        ]);

        const rangeData = await rangeRes.json();
        if (rangeData.error) {
          setError(rangeData.error);
          return;
        }
        const property: PropertyRangeResult | undefined = rangeData.properties?.[0];
        if (!property) {
          setError("Bien introuvable pour cette période.");
          return;
        }
        setRangeResult(property);

        const cleaningData = await cleaningRes.json();
        setCleaning(cleaningData.error ? null : (cleaningData.properties?.[0] ?? null));

        const reservationsData = await reservationsRes.json();
        setReservations(
          reservationsData.error
            ? []
            : (reservationsData.reservations ?? []).map(
                (r: ReservationDetail) => ({ ...r, occupancyRateOfMonth: r.occupancyRateOfMonth ?? null })
              )
        );

        const calendarData = await calendarRes.json();
        setCalendarDays(calendarData.error ? null : calendarData.days);

        const bookingWindowData = await bookingWindowRes.json();
        setBookingWindow(bookingWindowData.error ? null : bookingWindowData);
      } else {
        const monthlyParams = new URLSearchParams({
          year: String(targetYear),
          propertyIds: targetPropertyId,
          includeExpenses: "1",
        });
        const cleaningParams = new URLSearchParams({
          year: String(targetYear),
          months: String(targetMonth),
          propertyIds: targetPropertyId,
        });
        const reservationsParams = new URLSearchParams({
          propertyId: targetPropertyId,
          year: String(targetYear),
          months: String(targetMonth),
        });
        const calendarParams = new URLSearchParams({
          propertyId: targetPropertyId,
          year: String(targetYear),
          month: String(targetMonth),
        });

        const [monthlyRes, cleaningRes, reservationsRes, calendarRes, bookingWindowRes] = await Promise.all([
          fetch(`/api/finance/monthly?${monthlyParams.toString()}`),
          fetch(`/api/finance/cleaning?${cleaningParams.toString()}`),
          fetch(`/api/finance/reservations?${reservationsParams.toString()}`),
          fetch(`/api/finance/calendar?${calendarParams.toString()}`),
          fetch(`/api/finance/booking-window?${bookingWindowParams.toString()}`),
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

        const bookingWindowData = await bookingWindowRes.json();
        setBookingWindow(bookingWindowData.error ? null : bookingWindowData);
      }
    } catch {
      setError("Impossible de charger les données.");
    } finally {
      setLoading(false);
    }
  }

  // Cet onglet reste monté en permanence (voir DashboardClient — les onglets
  // ne sont plus démontés au changement d'onglet, pour garder le dernier
  // tableau chargé au lieu de repartir d'une page vide) : un nouveau
  // `request` (navigation depuis Owner ou Tendances) doit donc explicitement
  // remettre à jour la sélection affichée (bien/mode/période), pas seulement
  // déclencher le chargement.
  useEffect(() => {
    if (!request) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPropertyId(request.propertyId);
    if ("startDate" in request) {
      setMode("range");
      setRangeStart(request.startDate);
      setRangeEnd(request.endDate);
    } else {
      setMode("month");
      setYear(request.year);
      setMonth(request.month);
    }
    // Déclenche volontairement le même chargement que le bouton "Charger".
    load(request);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.token]);

  const rentType = properties.find((p) => p.id === propertyId)?.rentType ?? null;
  const monthData = monthly?.months.find((m) => m.month === month) ?? null;

  // Vue unifiée mois/plage : en mode plage, fixedRentAmountCents est forcé à
  // null (le loyer fixe est mensuel — non proratisable de façon évidente sur
  // une plage arbitraire), ce qui désactive naturellement Loyer/Excess/Loyer
  // fixe/Profit (modèle Fixe pur) pour ce mode sans logique supplémentaire.
  const activeMeta: PropertyMetaCommon | null = useMemo(() => {
    if (mode === "range") return rangeResult ? { ...rangeResult, fixedRentAmountCents: null } : null;
    return monthly;
  }, [mode, rangeResult, monthly]);

  const activeFinance: FinanceFiguresCommon | null = useMemo(() => {
    if (mode === "range") return rangeResult?.finance ?? null;
    return monthData;
  }, [mode, rangeResult, monthData]);

  const figures = useMemo(() => {
    if (!activeMeta || !activeFinance) return null;

    const netCommissionableRevenueCents = activeFinance.netRevenueCents;
    const commissionCents =
      rentType !== "fixe" && activeMeta.commissionPercent != null
        ? Math.round((netCommissionableRevenueCents * activeMeta.commissionPercent) / 100)
        : null;
    const netRevenueAfterCommissionCents = netCommissionableRevenueCents - (commissionCents ?? 0); // "Owner Gross"
    const ownerNetCents = netRevenueAfterCommissionCents - activeFinance.expensesCents; // "Owner Net"

    const loyerCents =
      rentType != null && RENT_TYPES_WITH_LOYER.includes(rentType) && activeMeta.fixedRentAmountCents != null
        ? activeMeta.fixedRentAmountCents
        : null;
    // Excess = Owner Net − Loyer (pas Owner Gross − Loyer) : l'écart au-dessus
    // du loyer garanti doit tenir compte des Expenses déjà déduites du owner.
    const excessCents = loyerCents != null ? ownerNetCents - loyerCents : null;
    const avgGrossNightlyRateCents =
      activeFinance.checkoutNights > 0 ? Math.round(activeFinance.rentsCents / activeFinance.checkoutNights) : null;

    const fixedRentCents =
      activeMeta.isFixedRent && activeMeta.fixedRentAmountCents != null ? activeMeta.fixedRentAmountCents : null;
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
    const baseProfitCents = activeMeta.isFixedRent
      ? fixedRentCents != null
        ? netRevenueAfterCommissionCents - fixedRentCents
        : null
      : commissionCents;
    const profitCents =
      baseProfitCents != null ? baseProfitCents + activeFinance.cityTaxCents + (cleaningProfitCents ?? 0) : null;

    return {
      netCommissionableRevenueCents,
      commissionCents,
      netRevenueAfterCommissionCents,
      ownerNetCents,
      loyerCents,
      excessCents,
      avgGrossNightlyRateCents,
      fixedRentCents,
      cleaningProfitCents,
      profitCents,
    };
  }, [activeMeta, activeFinance, cleaning, rentType]);

  // Pour les nuits occupées, affiche le prix réellement facturé pour la
  // réservation (prix brut/nuit calculé depuis VRPlatform, cf. Réservations)
  // plutôt que le tarif calendrier Guesty, qui reflète le prix affiché
  // aujourd'hui et pas ce qui a été effectivement payé.
  const enrichedCalendarDays = useMemo(() => {
    if (!calendarDays) return null;
    const reservationByConfirmation = new Map(
      (reservations ?? []).filter((r) => r.confirmationCode).map((r) => [r.confirmationCode, r])
    );
    return calendarDays.map((day) => {
      if (day.status !== "occupied" || !day.confirmationCode) return day;
      const reservation = reservationByConfirmation.get(day.confirmationCode);
      if (!reservation || reservation.grossNightlyRateCents == null) return day;
      return { ...day, priceCents: reservation.grossNightlyRateCents };
    });
  }, [calendarDays, reservations]);

  // TR calculé depuis le calendrier Guesty (occupé / (occupé + libre)), pour
  // ne pas compter les nuits bloquées manuellement (travaux, usage
  // personnel...) dans le dénominateur — contrairement au TR VRPlatform des
  // autres onglets (nightsBooked / jours du mois), qui n'a pas connaissance
  // des blocages Guesty.
  const calendarStats = useMemo(() => {
    if (!calendarDays) return null;
    let occupiedNights = 0;
    let freeNights = 0;
    let blockedNights = 0;
    let freeNightsAmountCents = 0;
    for (const day of calendarDays) {
      if (day.status === "occupied") occupiedNights++;
      else if (day.status === "available") {
        freeNights++;
        if (day.priceCents != null) freeNightsAmountCents += day.priceCents;
      } else if (day.status === "blocked") blockedNights++;
    }
    const rentableNights = occupiedNights + freeNights;
    const fillRate = rentableNights > 0 ? occupiedNights / rentableNights : 0;
    return { occupiedNights, freeNights, blockedNights, freeNightsAmountCents, fillRate };
  }, [calendarDays]);

  // Prix brut moyen à obtenir sur les nuits encore libres pour combler le
  // déficit d'Excess actuel, en ne comptant que les nuits nécessaires pour
  // atteindre un remplissage de 80% (pas 100%, cf. TARGET_FILL_RATE) — donc
  // "à quel prix dois-je vendre les nuits libres pour repasser en Excess
  // positif", pas "si je vends tout à ce prix-là".
  const breakEvenPricing = useMemo(() => {
    if (!calendarStats || !figures || rentType == null || activeMeta == null) return null;
    if (!RENT_TYPES_WITH_LOYER.includes(rentType) || figures.excessCents == null) return null;

    const deficitCents = -figures.excessCents;
    if (deficitCents <= 0) return { status: "already-positive" as const };

    const rentableNights = calendarStats.occupiedNights + calendarStats.freeNights;
    const targetOccupiedNights = Math.round(rentableNights * TARGET_FILL_RATE);
    const nightsToSell = Math.min(
      calendarStats.freeNights,
      Math.max(0, targetOccupiedNights - calendarStats.occupiedNights)
    );
    if (nightsToSell <= 0) return { status: "target-unreachable" as const };

    // Fixe pur : pas de commission de gestion prélevée (cf. RENT_TYPES_WITH_LOYER) —
    // tout le Net Commissionable Revenue s'ajoute au Net Revenue. Variable et
    // Fixe + variable : la commission de gestion du bien est déduite.
    const managementFactor = rentType === "fixe" ? 1 : 1 - (activeMeta.commissionPercent ?? 0) / 100;
    if (managementFactor <= 0) return null;

    const requiredGrossPriceCents = Math.round(
      deficitCents / (nightsToSell * (1 - CHANNEL_FEE_RATE_REFERENCE) * managementFactor)
    );
    return { status: "computed" as const, nightsToSell, deficitCents, requiredGrossPriceCents };
  }, [calendarStats, figures, rentType, activeMeta]);

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
          case "ownerNet":
            cmp = reservationOwnerNetCents(a) - reservationOwnerNetCents(b);
            break;
          case "occupancyRateOfMonth":
            cmp = (a.occupancyRateOfMonth ?? 0) - (b.occupancyRateOfMonth ?? 0);
            break;
        }
        return direction === "asc" ? cmp : -cmp;
      })
    : null;

  const periodSummary =
    mode === "range" ? `${formatDate(rangeStart)} → ${formatDate(rangeEnd)}` : `${MONTH_LABELS_SHORT[month - 1]} ${year}`;

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
              <div className="flex gap-1 rounded-[8px] border border-black/10 bg-black/[0.03] p-0.5">
                <button
                  type="button"
                  onClick={() => setMode("month")}
                  className={`flex-1 rounded-[6px] px-2.5 py-1 text-[12px] font-medium transition ${
                    mode === "month" ? "bg-white text-[#1d1d1f] shadow-sm" : "text-[#6e6e73] hover:text-[#1d1d1f]"
                  }`}
                >
                  Mois
                </button>
                <button
                  type="button"
                  onClick={() => setMode("range")}
                  className={`flex-1 rounded-[6px] px-2.5 py-1 text-[12px] font-medium transition ${
                    mode === "range" ? "bg-white text-[#1d1d1f] shadow-sm" : "text-[#6e6e73] hover:text-[#1d1d1f]"
                  }`}
                >
                  Plage de dates
                </button>
              </div>

              {mode === "month" ? (
                <>
                  <div className="mt-3">
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
                </>
              ) : (
                <div className="mt-3 flex items-end gap-2">
                  <div>
                    <label className="field-label" htmlFor="analysis-range-start">
                      Du
                    </label>
                    <input
                      id="analysis-range-start"
                      type="date"
                      value={rangeStart}
                      max={rangeEnd}
                      onChange={(e) => setRangeStart(e.target.value)}
                      className="mt-1 rounded-[10px] border border-black/10 bg-white px-3 py-2 text-[14px] text-[#1d1d1f] shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus:border-[#0071e3] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="analysis-range-end">
                      Au
                    </label>
                    <input
                      id="analysis-range-end"
                      type="date"
                      value={rangeEnd}
                      min={rangeStart}
                      onChange={(e) => setRangeEnd(e.target.value)}
                      className="mt-1 rounded-[10px] border border-black/10 bg-white px-3 py-2 text-[14px] text-[#1d1d1f] shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus:border-[#0071e3] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
                    />
                  </div>
                </div>
              )}

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

        <button type="button" onClick={() => load()} disabled={loading} className="btn-secondary btn-sm">
          {loading ? "Chargement…" : activeMeta ? "Actualiser" : "Charger"}
        </button>
      </div>

      {error && <p className="text-[13px] text-red-600">{error}</p>}

      {activeMeta && activeFinance && figures && !loading && !error && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[16px] font-semibold text-[#1d1d1f]">
              {activeMeta.reference} — {periodSummary}
            </h3>
            <span className="rounded-full bg-[#0071e3]/10 px-2.5 py-1 text-[12px] font-medium text-[#0071e3]">
              {rentType != null ? RENT_TYPE_LABELS[rentType] : "Modèle inconnu"}
            </span>
            {activeMeta.notFoundReferences.length > 0 && (
              <span title={`Référence VRPlatform introuvable : ${activeMeta.notFoundReferences.join(", ")}`} className="text-amber-600">
                ⚠
              </span>
            )}
          </div>

          <div>
            <p className="mb-2 text-[12px] font-medium text-[#6e6e73]">Owner</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-8">
              <StatTile
                label="TR"
                title="Nuits occupées ÷ (nuits occupées + nuits libres) — les nuits bloquées manuellement (travaux, usage personnel...) ne comptent pas dans le calcul"
              >
                {calendarStats ? (
                  <span
                    className="inline-block rounded-full px-2 py-0.5 text-[13px] font-medium tabular-nums"
                    style={fillRateBadgeStyle(calendarStats.fillRate)}
                  >
                    {formatPercent(calendarStats.fillRate)}
                  </span>
                ) : (
                  <span
                    className="inline-block rounded-full px-2 py-0.5 text-[13px] font-medium tabular-nums"
                    style={fillRateBadgeStyle(activeFinance.fillRate)}
                  >
                    {formatPercent(activeFinance.fillRate)}
                  </span>
                )}
              </StatTile>
              <StatTile label="Nuits occupées">{calendarStats ? calendarStats.occupiedNights : "—"}</StatTile>
              <StatTile
                label="Nuits libres"
                title="Nombre de nuits libres et somme de leur prix affiché sur le calendrier (manque à gagner potentiel si tarif plein)"
              >
                {calendarStats ? (
                  <>
                    {calendarStats.freeNights}
                    <span className="ml-1.5 text-[11px] font-normal text-[#86868b]">
                      <Money cents={calendarStats.freeNightsAmountCents} />
                    </span>
                  </>
                ) : (
                  "—"
                )}
              </StatTile>
              <StatTile label="Net Comm. Revenue" title="Net Commissionable Revenue">
                <Money cents={figures.netCommissionableRevenueCents} />
              </StatTile>
              <StatTile label="Commission">
                <Money cents={figures.commissionCents} />
                {figures.commissionCents != null && activeMeta.commissionPercent != null && (
                  <span className="ml-1 text-[11px] font-normal text-[#86868b]">({activeMeta.commissionPercent}%)</span>
                )}
              </StatTile>
              <StatTile
                label="Expenses"
                title={
                  mode === "month"
                    ? "Operating & Maintenance Expenses + Adjustments + Processing Fees (configuration du owner statement VRPlatform) — cliquer pour le détail"
                    : "Operating & Maintenance Expenses + Adjustments + Processing Fees (configuration du owner statement VRPlatform)"
                }
                onClick={mode === "month" ? () => setShowExpenseDetail(true) : undefined}
              >
                <Money cents={activeFinance.expensesCents} />
              </StatTile>
              <StatTile label="Owner Gross" title="Net Commissionable Revenue − Commission (Expenses non déduites)">
                <Money cents={figures.netRevenueAfterCommissionCents} bold />
              </StatTile>
              <StatTile label="Owner Net" title="Owner Gross − Expenses">
                <SignedMoney cents={figures.ownerNetCents} bold />
              </StatTile>
              <StatTile label="Loyer" title={mode === "range" ? "Le loyer fixe est mensuel — non applicable en mode plage de dates." : undefined}>
                <Money cents={figures.loyerCents} />
              </StatTile>
              <StatTile
                label="Excess"
                title={mode === "range" ? "Le loyer fixe est mensuel — non applicable en mode plage de dates." : "Owner Net − Loyer"}
              >
                <SignedMoney cents={figures.excessCents} bold />
              </StatTile>
              <StatTile
                label="Prix pour Excess positif"
                title={
                  breakEvenPricing == null
                    ? "Nécessite un calendrier chargé et un modèle avec loyer (Fixe ou Fixe + variable)."
                    : breakEvenPricing.status === "already-positive"
                      ? "L'Excess est déjà positif sur cette période."
                      : breakEvenPricing.status === "target-unreachable"
                        ? "Le remplissage cible de 80% (nuits bloquées exclues) est déjà atteint — vendre plus cher les nuits libres restantes ne suffit pas seul à combler le déficit."
                        : `Prix brut moyen (avant commission plateforme, ${Math.round(CHANNEL_FEE_RATE_REFERENCE * 100)}% de référence) à obtenir sur les ${breakEvenPricing.nightsToSell} nuits libres nécessaires pour atteindre 80% de remplissage (nuits bloquées exclues) et combler le déficit d'Excess de ${formatEuros(breakEvenPricing.deficitCents / 100)}.${rentType === "fixe" ? "" : ` Commission de gestion (${activeMeta?.commissionPercent ?? 0}%) déduite.`}`
                }
              >
                {breakEvenPricing == null ? (
                  "—"
                ) : breakEvenPricing.status === "already-positive" ? (
                  <span className="text-emerald-600">Déjà positif</span>
                ) : breakEvenPricing.status === "target-unreachable" ? (
                  <span className="text-[#6e6e73]">Objectif atteint</span>
                ) : (
                  <>
                    ~{formatEuros(breakEvenPricing.requiredGrossPriceCents / 100)}
                    <span className="ml-1 text-[11px] font-normal text-[#86868b]">/nuit ({breakEvenPricing.nightsToSell} nuits)</span>
                  </>
                )}
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
                <Money cents={activeFinance.rentsCents} />
              </StatTile>
              <StatTile label="Channel Fees">
                <Money cents={activeFinance.channelFeesCents} />
              </StatTile>
              <StatTile label="City Tax">
                <Money cents={activeFinance.cityTaxCents} />
              </StatTile>
              <StatTile label="Transfer Fees">
                <Money cents={activeFinance.transferFeesCents} />
              </StatTile>
              <StatTile label="Ménage" title="(Prix client − coût prestataire) × nombre de check-out">
                <SignedMoney cents={figures.cleaningProfitCents} bold />
              </StatTile>
              <StatTile
                label="Loyer fixe"
                title={
                  mode === "range"
                    ? "Le loyer fixe est mensuel — non applicable en mode plage de dates."
                    : "Loyer fixe, uniquement pour le modèle Fixe pur"
                }
              >
                <Money cents={figures.fixedRentCents} />
              </StatTile>
              <StatTile label="Profit" title="(Commission, ou Net Revenue − Loyer fixe) + City Tax + Profit ménage">
                <SignedMoney cents={figures.profitCents} bold />
              </StatTile>
            </div>
          </div>

          <div>
            <p className="mb-2 text-[12px] font-medium text-[#6e6e73]">Tendances (12 derniers mois)</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              <StatTile
                label="Fenêtre de réservation"
                title="Médiane du nombre de jours entre la date de réservation et le check-in, sur les réservations faites au cours des 12 derniers mois — y compris celles dont le check-in est encore à venir."
              >
                {bookingWindow?.medianLeadTimeDays != null
                  ? `${Math.round(bookingWindow.medianLeadTimeDays)} j`
                  : "—"}
              </StatTile>
              <StatTile
                label="Durée moyenne de séjour"
                title="Moyenne des nuits par réservation, sur le même échantillon (réservations faites au cours des 12 derniers mois)."
              >
                {bookingWindow?.avgLengthOfStayNights != null
                  ? `${bookingWindow.avgLengthOfStayNights.toFixed(1)} nuits`
                  : "—"}
              </StatTile>
              <StatTile label="Réservations (12 mois)" title="Nombre de réservations faites au cours des 12 derniers mois, base de tous les indicateurs de cette section.">
                {bookingWindow?.sampleSize ?? "—"}
              </StatTile>
              <StatTile label="Réservées < 7 j avant" title="Part des réservations faites moins de 7 jours avant le check-in, sur les 12 derniers mois.">
                {bookingWindow?.leadTimeBuckets.under7Percent != null
                  ? `${Math.round(bookingWindow.leadTimeBuckets.under7Percent)}%`
                  : "—"}
              </StatTile>
              <StatTile label="Réservées 7-15 j avant" title="Part des réservations faites entre 7 et 15 jours avant le check-in, sur les 12 derniers mois.">
                {bookingWindow?.leadTimeBuckets.from7To15Percent != null
                  ? `${Math.round(bookingWindow.leadTimeBuckets.from7To15Percent)}%`
                  : "—"}
              </StatTile>
              <StatTile label="Réservées > 15 j avant" title="Part des réservations faites plus de 15 jours avant le check-in, sur les 12 derniers mois.">
                {bookingWindow?.leadTimeBuckets.over15Percent != null
                  ? `${Math.round(bookingWindow.leadTimeBuckets.over15Percent)}%`
                  : "—"}
              </StatTile>
            </div>
          </div>

          <div>
            <p className="mb-2 text-[12px] font-medium text-[#6e6e73]">Calendrier</p>
            {enrichedCalendarDays ? (
              <div className="flex flex-wrap items-start gap-4">
                <div className="max-w-[560px] flex-1 rounded-[14px] border border-black/[0.06] bg-white p-3.5">
                  <CalendarGrid days={enrichedCalendarDays} />
                </div>
                <div className="min-w-[320px] flex-1 rounded-[14px] border border-black/[0.06] bg-white p-3.5">
                  <DailyPriceChart days={enrichedCalendarDays} />
                </div>
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
                        {mode === "month" && (
                          <SortHeader
                            label="TO"
                            sortKey="occupancyRateOfMonth"
                            activeKey={sortKey}
                            direction={direction}
                            onSort={handleSort}
                            title="TO du mois de la réservation"
                          />
                        )}
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
                        <SortHeader
                          label="Owner Gross"
                          sortKey="netRevenue"
                          activeKey={sortKey}
                          direction={direction}
                          onSort={handleSort}
                          narrow
                          title="Net Commissionable Revenue − Commission (Expenses non déduites)"
                        />
                        <SortHeader label="Expenses" sortKey="expenses" activeKey={sortKey} direction={direction} onSort={handleSort} narrow />
                        <SortHeader
                          label="Owner Net"
                          sortKey="ownerNet"
                          activeKey={sortKey}
                          direction={direction}
                          onSort={handleSort}
                          narrow
                          title="Owner Gross − Expenses"
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
                          {mode === "month" && (
                            <td className="py-1.5 px-2 text-right">
                              <OccupancyBadge fillRate={r.occupancyRateOfMonth} />
                            </td>
                          )}
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
                            <Money cents={r.netRevenueCents} bold />
                          </td>
                          <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">
                            <Money cents={r.expensesCents} />
                          </td>
                          <td className="py-1.5 pl-2 pr-3 text-right tabular-nums">
                            <SignedMoney cents={reservationOwnerNetCents(r)} bold />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="text-[13px] text-[#6e6e73]">Aucune réservation sur cette période.</p>
            )}
          </div>
        </div>
      )}

      {!activeMeta && !loading && !error && (
        <p className="text-[13px] text-[#6e6e73]">Choisis un bien et une période, puis charge les données.</p>
      )}

      {showExpenseDetail && monthly && mode === "month" && (
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
