import { NextResponse } from "next/server";
import { getCurrentProfile, listPropertiesForFinance } from "@/lib/queries";
import { getPortfolioGuestyListingIds, getPortfolioReservationDetails, isVrPlatformConfigured } from "@/lib/vrplatform";
import { getGuestyCleaningPrices, isGuestyConfigured, mapWithGuestyConcurrency } from "@/lib/guesty";

export const dynamic = "force-dynamic";

export interface CleaningCommissionCatchupRow {
  propertyId: string;
  reference: string;
  reservationId: string;
  guestName: string | null;
  checkIn: string;
  checkOut: string;
  /** Pourcentage de commission M.G.B du bien (ex: 20 pour 20 %). */
  commissionPercent: number;
  /** Net Commissionable Revenue de la réservation — même "brut" que partout
   * ailleurs dans l'app (Rents − Channel Fees), base actuelle de calcul de
   * la commission. */
  grossCents: number;
  /** Prix ménage facturé au client (Guesty), constant par bien quel que
   * soit le séjour — null si Guesty n'est pas configuré/disponible pour ce
   * bien. */
  cleaningFeeCents: number | null;
  cleaningError: string | null;
}

/** Pour chaque réservation d'un bien à commission variable, calcule le
 * "brut" (Net Commissionable Revenue, base actuelle de la commission) et le
 * prix ménage Guesty du bien, pour que le client puisse comparer la
 * commission réellement appliquée (sur le brut seul) à ce qu'elle serait si
 * elle portait aussi sur le ménage — un rattrapage à facturer au
 * propriétaire sur la part ménage jamais commissionnée jusqu'ici. */
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
    const properties = allProperties.filter(
      (p) => propertyIds.has(p.id) && p.rentType !== "fixe" && p.commissionPercent != null
    );
    if (properties.length === 0) {
      return NextResponse.json(
        { error: "Aucun bien à commission variable ne correspond aux filtres." },
        { status: 404 }
      );
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

    const reservations = await getPortfolioReservationDetails(portfolioProperties, year, months);
    const commissionPercentByPropertyId = new Map(portfolioProperties.map((p) => [p.propertyId, p.commissionPercent ?? 0]));

    const cleaningFeeByPropertyId = new Map<string, number | null>();
    const cleaningErrorByPropertyId = new Map<string, string | null>();
    if (isGuestyConfigured()) {
      const guestyListingIdByPropertyId = await getPortfolioGuestyListingIds(portfolioProperties);
      await mapWithGuestyConcurrency(portfolioProperties, async (property) => {
        const guestyListingId = guestyListingIdByPropertyId.get(property.propertyId) ?? null;
        if (!guestyListingId) {
          cleaningErrorByPropertyId.set(property.propertyId, "ID Guesty introuvable pour ce bien.");
          return;
        }
        try {
          const prices = await getGuestyCleaningPrices(guestyListingId);
          cleaningFeeByPropertyId.set(property.propertyId, prices.standard != null ? Math.round(prices.standard * 100) : null);
        } catch (err) {
          cleaningErrorByPropertyId.set(property.propertyId, err instanceof Error ? err.message : "Erreur Guesty inconnue.");
        }
      });
    }

    const rows: CleaningCommissionCatchupRow[] = reservations.map((r) => ({
      propertyId: r.propertyId,
      reference: r.reference,
      reservationId: r.reservationId,
      guestName: r.guestName,
      checkIn: r.checkIn,
      checkOut: r.checkOut,
      commissionPercent: commissionPercentByPropertyId.get(r.propertyId) ?? 0,
      grossCents: r.netCommissionableRevenueCents,
      cleaningFeeCents: cleaningFeeByPropertyId.get(r.propertyId) ?? null,
      cleaningError: cleaningErrorByPropertyId.get(r.propertyId) ?? null,
    }));

    return NextResponse.json({ rows }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur VRPlatform inconnue." },
      { status: 502 }
    );
  }
}
