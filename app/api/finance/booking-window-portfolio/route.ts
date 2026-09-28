import { NextResponse } from "next/server";
import { getCurrentProfile, listPropertiesForFinance } from "@/lib/queries";
import {
  getPortfolioBookingWindowStats,
  getPortfolioUpcomingReservationRates,
  isVrPlatformConfigured,
  type UpcomingReservationRate,
} from "@/lib/vrplatform";
import { getGuestyCalendarMonth, isGuestyConfigured, mapWithGuestyConcurrency, type GuestyCalendarDay } from "@/lib/guesty";

export const dynamic = "force-dynamic";

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** TR d'une fenêtre de jours à partir du calendrier Guesty : occupé ÷
 * (occupé + libre), les nuits bloquées manuellement n'entrant ni au
 * numérateur ni au dénominateur — même logique que l'onglet Analyse. */
function fillRateFromCalendar(days: GuestyCalendarDay[]): number | null {
  const occupied = days.filter((d) => d.status === "occupied").length;
  const free = days.filter((d) => d.status === "available").length;
  const rentable = occupied + free;
  return rentable > 0 ? occupied / rentable : null;
}

interface PricingComparison {
  avgSoldCents: number | null;
  avgFreeCents: number | null;
  /** (avgFree − avgSold) / avgSold × 100 — positif si les nuits encore
   * libres sont affichées plus cher que ce qui se vend réellement (signal
   * de sur-tarification possible). */
  diffPercent: number | null;
}

/** Prix moyen des nuits occupées (prix réellement facturé, via
 * rateByConfirmationCode) contre prix moyen affiché des nuits encore libres,
 * sur une fenêtre du calendrier — même logique que CalendarGrid/
 * DailyPriceChart (le prix Guesty d'une nuit occupée reflète le tarif du
 * jour, pas ce qui a été payé, d'où la correspondance par confirmationCode). */
function pricingFromCalendar(days: GuestyCalendarDay[], rateByConfirmationCode: Map<string, number>): PricingComparison {
  const soldCents: number[] = [];
  const freeCents: number[] = [];
  for (const day of days) {
    if (day.status === "occupied") {
      const rate = day.confirmationCode ? rateByConfirmationCode.get(day.confirmationCode) : undefined;
      const cents = rate ?? day.priceCents;
      if (cents != null) soldCents.push(cents);
    } else if (day.status === "available" && day.priceCents != null) {
      freeCents.push(day.priceCents);
    }
  }
  const avgSoldCents = soldCents.length > 0 ? Math.round(soldCents.reduce((s, v) => s + v, 0) / soldCents.length) : null;
  const avgFreeCents = freeCents.length > 0 ? Math.round(freeCents.reduce((s, v) => s + v, 0) / freeCents.length) : null;
  const diffPercent =
    avgSoldCents != null && avgFreeCents != null && avgSoldCents > 0
      ? Math.round(((avgFreeCents - avgSoldCents) / avgSoldCents) * 100)
      : null;
  return { avgSoldCents, avgFreeCents, diffPercent };
}

/** Fenêtre de réservation médiane et durée moyenne de séjour (12 derniers
 * mois glissants, voir getPortfolioBookingWindowStats) pour chaque bien du
 * portefeuille — utilisé par les onglets Remplissage et Tendances.
 *
 * `includeShortTermFillRate=1` ajoute le TR des 15 prochains jours et des
 * 15 jours suivants (calendrier Guesty) — repère un bien qui se remplit
 * moins vite que d'habitude à court terme.
 *
 * `includePricingComparison=1` ajoute, sur les deux mêmes fenêtres, le prix
 * moyen des nuits déjà vendues contre celui des nuits encore libres —
 * repère un bien potentiellement sur-tarifé sur ce qui n'est pas encore
 * parti. Implique includeShortTermFillRate (même calendrier Guesty), plus
 * un appel VRPlatform pour le prix réellement facturé des réservations à
 * venir.
 *
 * Les deux options sont désactivées par défaut (coûtent un ou deux appels
 * externes par bien) et réservées à l'onglet Tendances. */
export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });
  if (!isVrPlatformConfigured()) {
    return NextResponse.json({ error: "VRPlatform n'est pas configuré sur ce déploiement." }, { status: 500 });
  }

  const searchParams = new URL(request.url).searchParams;
  const propertyIdsParam = searchParams.get("propertyIds");
  const propertyIds = propertyIdsParam ? new Set(propertyIdsParam.split(",")) : null;
  const includePricingComparison = searchParams.get("includePricingComparison") === "1";
  const includeShortTermFillRate = searchParams.get("includeShortTermFillRate") === "1" || includePricingComparison;

  try {
    const allProperties = await listPropertiesForFinance();
    const properties = propertyIds ? allProperties.filter((p) => propertyIds.has(p.id)) : allProperties;
    if (propertyIds && properties.length === 0) {
      return NextResponse.json({ error: "Aucun bien ne correspond aux filtres." }, { status: 404 });
    }

    const portfolioProperties = properties.map((p) => ({
      propertyId: p.id,
      reference: p.reference,
      name: p.name,
      rentType: p.rentType,
      rentAmount: p.rentAmount,
      commissionPercent: p.commissionPercent,
      extraVrplatformReferences: p.extraVrplatformReferences,
    }));

    const results = await getPortfolioBookingWindowStats(portfolioProperties);

    if (!includeShortTermFillRate || !isGuestyConfigured()) {
      return NextResponse.json({ properties: results }, { headers: { "Cache-Control": "no-store, max-age=0" } });
    }

    const today = new Date();
    const windowAStart = isoDate(today);
    const windowAEnd = isoDate(addDays(today, 14));
    const windowBStart = isoDate(addDays(today, 15));
    const windowBEnd = isoDate(addDays(today, 29));

    const ratesByPropertyId = includePricingComparison
      ? await getPortfolioUpcomingReservationRates(portfolioProperties, windowAStart, windowBEnd)
      : null;

    const withIndicators = await mapWithGuestyConcurrency(results, async (r) => {
      if (!r.guestyListingId) {
        return {
          ...r,
          next15DaysFillRate: null,
          next15To30DaysFillRate: null,
          next15DaysPricing: null,
          next15To30DaysPricing: null,
        };
      }
      try {
        const [daysA, daysB] = await Promise.all([
          getGuestyCalendarMonth(r.guestyListingId, windowAStart, windowAEnd),
          getGuestyCalendarMonth(r.guestyListingId, windowBStart, windowBEnd),
        ]);

        let next15DaysPricing: PricingComparison | null = null;
        let next15To30DaysPricing: PricingComparison | null = null;
        if (includePricingComparison) {
          const rates: UpcomingReservationRate[] = ratesByPropertyId?.get(r.propertyId) ?? [];
          const rateByConfirmationCode = new Map(
            rates
              .filter((rate): rate is UpcomingReservationRate & { confirmationCode: string; grossNightlyRateCents: number } =>
                rate.confirmationCode != null && rate.grossNightlyRateCents != null
              )
              .map((rate) => [rate.confirmationCode, rate.grossNightlyRateCents])
          );
          next15DaysPricing = pricingFromCalendar(daysA, rateByConfirmationCode);
          next15To30DaysPricing = pricingFromCalendar(daysB, rateByConfirmationCode);
        }

        return {
          ...r,
          next15DaysFillRate: fillRateFromCalendar(daysA),
          next15To30DaysFillRate: fillRateFromCalendar(daysB),
          next15DaysPricing,
          next15To30DaysPricing,
        };
      } catch {
        return {
          ...r,
          next15DaysFillRate: null,
          next15To30DaysFillRate: null,
          next15DaysPricing: null,
          next15To30DaysPricing: null,
        };
      }
    });

    return NextResponse.json({ properties: withIndicators }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur VRPlatform inconnue." },
      { status: 502 }
    );
  }
}
