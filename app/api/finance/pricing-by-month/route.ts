import { NextResponse } from "next/server";
import { getCurrentProfile, listPropertiesForFinance } from "@/lib/queries";
import {
  getPortfolioGuestyListingIds,
  getPortfolioUpcomingReservationRates,
  isVrPlatformConfigured,
  type UpcomingReservationRate,
} from "@/lib/vrplatform";
import { getGuestyCalendarMonth, isGuestyConfigured, mapWithGuestyConcurrency, type GuestyCalendarDay } from "@/lib/guesty";

export const dynamic = "force-dynamic";

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

interface PricingComparison {
  avgSoldCents: number | null;
  avgFreeCents: number | null;
  /** (avgFree − avgSold) / avgSold × 100 — positif si les nuits encore
   * libres sont affichées plus cher que ce qui se vend réellement. */
  diffPercent: number | null;
}

/** Même logique que /api/finance/booking-window-portfolio : prix réellement
 * facturé (via rateByConfirmationCode) pour les nuits occupées, prix affiché
 * du calendrier pour les nuits encore libres. */
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

/** Prix moyen des nuits vendues contre prix moyen des nuits encore libres,
 * pour un ou plusieurs mois calendaires, sur chaque bien du portefeuille —
 * colonne "Prix vendu/libre" de l'onglet Remplissage (même calcul que le
 * couple TR/pricing de l'onglet Tendances, mais sur des mois calendaires au
 * lieu de fenêtres glissantes de 15 jours).
 *
 * Le prix "libre" vient du calendrier Guesty EN TEMPS RÉEL : pour un mois
 * déjà terminé, il n'y a plus de nuits "encore libres" au sens propre — le
 * résultat reste calculé (comportement demandé) mais n'est significatif que
 * pour le mois en cours ou un mois futur.
 *
 * Coûteux : un appel VRPlatform + jusqu'à N appels Guesty (bornés à 2 en
 * parallèle) par mois sélectionné. Les mois sont traités séquentiellement
 * pour ne pas cumuler la charge sur VRPlatform/Guesty en cas de sélection de
 * plusieurs mois sur tout le portefeuille. */
export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });
  if (!isVrPlatformConfigured()) {
    return NextResponse.json({ error: "VRPlatform n'est pas configuré sur ce déploiement." }, { status: 500 });
  }
  if (!isGuestyConfigured()) {
    return NextResponse.json({ error: "Guesty n'est pas configuré sur ce déploiement." }, { status: 500 });
  }

  const searchParams = new URL(request.url).searchParams;
  const year = Number.parseInt(searchParams.get("year") ?? "", 10);
  const months = (searchParams.get("months") ?? "")
    .split(",")
    .map((m) => Number.parseInt(m, 10))
    .filter((m) => Number.isFinite(m) && m >= 1 && m <= 12);
  if (!Number.isFinite(year) || months.length === 0) {
    return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });
  }

  const propertyIdsParam = searchParams.get("propertyIds");
  const propertyIds = propertyIdsParam ? new Set(propertyIdsParam.split(",")) : null;

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

    const guestyListingIdByPropertyId = await getPortfolioGuestyListingIds(portfolioProperties);
    const pricingByPropertyId = new Map<string, Map<number, PricingComparison>>(
      portfolioProperties.map((p) => [p.propertyId, new Map()])
    );

    for (const month of months) {
      const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
      const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(daysInMonth(year, month)).padStart(2, "0")}`;

      const ratesByPropertyId = await getPortfolioUpcomingReservationRates(portfolioProperties, monthStart, monthEnd);

      await mapWithGuestyConcurrency(portfolioProperties, async (property) => {
        const guestyListingId = guestyListingIdByPropertyId.get(property.propertyId) ?? null;
        if (!guestyListingId) return;
        try {
          const days = await getGuestyCalendarMonth(guestyListingId, monthStart, monthEnd);
          const rates: UpcomingReservationRate[] = ratesByPropertyId.get(property.propertyId) ?? [];
          const rateByConfirmationCode = new Map(
            rates
              .filter((rate): rate is UpcomingReservationRate & { confirmationCode: string; grossNightlyRateCents: number } =>
                rate.confirmationCode != null && rate.grossNightlyRateCents != null
              )
              .map((rate) => [rate.confirmationCode, rate.grossNightlyRateCents])
          );
          pricingByPropertyId.get(property.propertyId)?.set(month, pricingFromCalendar(days, rateByConfirmationCode));
        } catch {
          // Un mois/bien en échec (Guesty indisponible pour ce listing...) ne
          // doit pas faire échouer les autres — la cellule restera "—".
        }
      });
    }

    const result = portfolioProperties.map((p) => ({
      propertyId: p.propertyId,
      months: months.map((month) => ({
        month,
        ...(pricingByPropertyId.get(p.propertyId)?.get(month) ?? { avgSoldCents: null, avgFreeCents: null, diffPercent: null }),
      })),
    }));

    return NextResponse.json({ properties: result }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur inconnue." },
      { status: 502 }
    );
  }
}
