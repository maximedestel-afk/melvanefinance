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
  bookingPlatform: string | null;
  checkIn: string;
  checkOut: string;
  /** Rents brut de la réservation (Brut), avant déduction de la commission
   * de la plateforme de réservation. */
  grossCents: number;
  /** Commission prélevée par la plateforme de réservation (Airbnb, etc.),
   * en euros — déjà connue côté VRPlatform (lignes "Channel Commissions"),
   * pas un pourcentage recalculé. */
  platformCommissionCents: number;
  /** Prix ménage facturé au client (Guesty), constant par bien quel que
   * soit le séjour — null si Guesty n'est pas configuré/disponible pour ce
   * bien. */
  cleaningFeeCents: number | null;
  cleaningError: string | null;
}

/** Pour chaque réservation, la commission prélevée par la plateforme de
 * réservation (Airbnb...) est un montant en euros déjà connu côté
 * VRPlatform, mais aujourd'hui entièrement imputé au Brut (Rents) — alors
 * que la plateforme la prélève en réalité sur tout ce que paie le client, y
 * compris le ménage. Cette route renvoie, par réservation, le Brut et le
 * ménage (pour reconstituer la base réelle) ainsi que le montant de
 * commission déjà connu, pour que le client puisse répartir ce montant au
 * prorata Brut/Ménage — la part qui retombe sur le ménage est le
 * rattrapage à reporter sur le propriétaire. */
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

    const reservations = await getPortfolioReservationDetails(portfolioProperties, year, months);

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
      bookingPlatform: r.bookingPlatform,
      checkIn: r.checkIn,
      checkOut: r.checkOut,
      grossCents: r.rentsCents,
      platformCommissionCents: r.channelFeesCents,
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
