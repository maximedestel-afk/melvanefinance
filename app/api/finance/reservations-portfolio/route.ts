import { NextResponse } from "next/server";
import { getCurrentProfile, listPropertiesForFinance } from "@/lib/queries";
import { getPortfolioReservationDetails, getPropertyOccupancyForMonths, isVrPlatformConfigured } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";

/** Version "plusieurs biens" de /api/finance/reservations — réservations de
 * tous les biens demandés fusionnées en une seule liste (propertyId/
 * reference sur chaque réservation), pour la sélection multi-biens de
 * l'onglet Réservations (même filtre biens/modèle/tags que l'onglet
 * Revenus). */
export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });
  if (!isVrPlatformConfigured()) {
    return NextResponse.json({ error: "VRPlatform n'est pas configuré sur ce déploiement." }, { status: 500 });
  }

  const searchParams = new URL(request.url).searchParams;
  const propertyIdsParam = searchParams.get("propertyIds");
  const year = Number.parseInt(searchParams.get("year") ?? "", 10);
  const months = (searchParams.get("months") ?? "")
    .split(",")
    .map((m) => Number.parseInt(m, 10))
    .filter((m) => Number.isInteger(m) && m >= 1 && m <= 12);
  if (!propertyIdsParam || !Number.isInteger(year) || months.length === 0) {
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

    const [reservations, occupancyResults] = await Promise.all([
      getPortfolioReservationDetails(portfolioProperties, year, months),
      getPropertyOccupancyForMonths(portfolioProperties, year, months),
    ]);

    // Taux d'occupation du mois de check-out de chaque réservation, propre
    // au bien de la réservation (même notion que l'onglet Remplissage).
    const fillRateByPropertyIdAndMonth = new Map(
      occupancyResults.map((r) => [r.propertyId, new Map(r.months.map((m) => [m.month, m.fillRate]))])
    );
    const reservationsWithOccupancy = reservations.map((r) => {
      const checkoutMonth = Number(r.checkOut.slice(5, 7));
      const occupancyRateOfMonth = fillRateByPropertyIdAndMonth.get(r.propertyId)?.get(checkoutMonth) ?? null;
      return { ...r, occupancyRateOfMonth };
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
