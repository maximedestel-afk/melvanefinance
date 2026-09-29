import { NextResponse } from "next/server";
import { getCurrentProfile, listPropertiesForFinance } from "@/lib/queries";
import {
  getPortfolioGuestyListingIds,
  getPortfolioReservationDetails,
  getPortfolioReservationDetailsByBookedRange,
  getPropertyOccupancyForMonths,
  isVrPlatformConfigured,
  type PortfolioReservationDetail,
} from "@/lib/vrplatform";
import { getGuestyCleaningPrices, isGuestyConfigured, mapWithGuestyConcurrency } from "@/lib/guesty";

export const dynamic = "force-dynamic";

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Version "plusieurs biens" de /api/finance/reservations — réservations de
 * tous les biens demandés fusionnées en une seule liste (propertyId/
 * reference sur chaque réservation), pour la sélection multi-biens de
 * l'onglet Réservations (même filtre biens/modèle/tags que l'onglet
 * Revenus).
 *
 * Deux modes, selon les paramètres reçus :
 * - `year` + `months` (comme avant) : réservations dont le check-out tombe
 *   dans ces mois.
 * - `days` : les réservations effectuées (bookedAt) au cours des `days`
 *   derniers jours, quel que soit le mois du séjour — "les dernières
 *   réservations". Le TO (occupancyRateOfMonth) n'a pas de sens ici (le
 *   check-out peut tomber n'importe quand dans le futur) et reste à null.
 *
 * Ajoute cleaningProfitCents (prix ménage facturé au client − coût
 * prestataire, via Guesty) à chaque réservation — un seul appel Guesty par
 * bien (pas par réservation), puisque ce prix est constant par bien, pas par
 * séjour. Une erreur Guesty (non configuré, listing introuvable...) laisse
 * juste cleaningProfitCents à null plutôt que de faire échouer tout
 * l'onglet, comme /api/finance/cleaning. */
export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });
  if (!isVrPlatformConfigured()) {
    return NextResponse.json({ error: "VRPlatform n'est pas configuré sur ce déploiement." }, { status: 500 });
  }

  const searchParams = new URL(request.url).searchParams;
  const propertyIdsParam = searchParams.get("propertyIds");
  const daysParam = searchParams.get("days");
  const days = daysParam != null ? Number.parseInt(daysParam, 10) : null;

  const year = Number.parseInt(searchParams.get("year") ?? "", 10);
  const months = (searchParams.get("months") ?? "")
    .split(",")
    .map((m) => Number.parseInt(m, 10))
    .filter((m) => Number.isInteger(m) && m >= 1 && m <= 12);

  if (!propertyIdsParam) {
    return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });
  }
  if (days != null) {
    if (!Number.isInteger(days) || days < 1) {
      return NextResponse.json({ error: "Nombre de jours invalide." }, { status: 400 });
    }
  } else if (!Number.isInteger(year) || months.length === 0) {
    return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });
  }

  const propertyIds = new Set(propertyIdsParam.split(","));

  try {
    const allProperties = await listPropertiesForFinance();
    const properties = allProperties.filter((p) => propertyIds.has(p.id));
    if (properties.length === 0) {
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

    let reservations: PortfolioReservationDetail[];
    let occupancyRateOfMonthByReservationId: Map<string, number | null>;

    if (days != null) {
      const untilDate = new Date();
      const sinceDate = new Date(untilDate);
      sinceDate.setUTCDate(sinceDate.getUTCDate() - (days - 1));
      reservations = await getPortfolioReservationDetailsByBookedRange(
        portfolioProperties,
        isoDate(sinceDate),
        isoDate(untilDate)
      );
      occupancyRateOfMonthByReservationId = new Map();
    } else {
      const [byBookedRangeReservations, occupancyResults] = await Promise.all([
        getPortfolioReservationDetails(portfolioProperties, year, months),
        getPropertyOccupancyForMonths(portfolioProperties, year, months),
      ]);
      reservations = byBookedRangeReservations;
      // Taux d'occupation du mois de check-out de chaque réservation, propre
      // au bien de la réservation (même notion que l'onglet Remplissage).
      const fillRateByPropertyIdAndMonth = new Map(
        occupancyResults.map((r) => [r.propertyId, new Map(r.months.map((m) => [m.month, m.fillRate]))])
      );
      occupancyRateOfMonthByReservationId = new Map(
        reservations.map((r) => [
          r.reservationId,
          fillRateByPropertyIdAndMonth.get(r.propertyId)?.get(Number(r.checkOut.slice(5, 7))) ?? null,
        ])
      );
    }

    // Profit ménage par check-out (constant par bien, cf. /api/finance/cleaning) —
    // un seul appel Guesty par bien, pas par réservation.
    const cleaningProfitByPropertyId = new Map<string, number | null>();
    if (isGuestyConfigured()) {
      const guestyListingIdByPropertyId = await getPortfolioGuestyListingIds(portfolioProperties);
      await mapWithGuestyConcurrency(portfolioProperties, async (property) => {
        const guestyListingId = guestyListingIdByPropertyId.get(property.propertyId) ?? null;
        if (!guestyListingId) return;
        try {
          const prices = await getGuestyCleaningPrices(guestyListingId);
          const cleaningProfitCents =
            prices.standard != null && prices.customField != null
              ? Math.round((prices.standard - prices.customField) * 100)
              : null;
          cleaningProfitByPropertyId.set(property.propertyId, cleaningProfitCents);
        } catch {
          // Laisse cleaningProfitCents à null pour ce bien plutôt que de
          // faire échouer tout l'onglet.
        }
      });
    }

    const reservationsWithOccupancy = reservations.map((r) => {
      const occupancyRateOfMonth = occupancyRateOfMonthByReservationId.get(r.reservationId) ?? null;
      const cleaningProfitCents = cleaningProfitByPropertyId.get(r.propertyId) ?? null;
      return { ...r, occupancyRateOfMonth, cleaningProfitCents };
    });

    return NextResponse.json(
      { reservations: reservationsWithOccupancy },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur VRPlatform inconnue." },
      { status: 502 }
    );
  }
}
