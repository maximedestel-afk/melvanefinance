import { NextResponse } from "next/server";
import { getCurrentProfile, listPropertiesForFinance } from "@/lib/queries";
import { getPropertyCheckoutsForMonths, isVrPlatformConfigured } from "@/lib/vrplatform";
import { getGuestyCleaningPrices, isGuestyConfigured, mapWithGuestyConcurrency } from "@/lib/guesty";

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
    .map((m) => Number.parseInt(m.trim(), 10))
    .filter((m) => Number.isInteger(m) && m >= 1 && m <= 12);
  if (!Number.isInteger(year) || months.length === 0) {
    return NextResponse.json({ error: "Année ou mois invalide." }, { status: 400 });
  }

  const propertyIdsParam = searchParams.get("propertyIds");
  const propertyIds = propertyIdsParam ? new Set(propertyIdsParam.split(",")) : null;

  try {
    const allProperties = await listPropertiesForFinance();
    const properties = propertyIds ? allProperties.filter((p) => propertyIds.has(p.id)) : allProperties;
    if (propertyIds && properties.length === 0) {
      return NextResponse.json({ error: "Aucun bien ne correspond aux filtres." }, { status: 404 });
    }

    const checkoutResults = await getPropertyCheckoutsForMonths(
      properties.map((p) => ({
        propertyId: p.id,
        reference: p.reference,
        name: p.name,
        rentType: p.rentType,
        rentAmount: p.rentAmount,
        commissionPercent: p.commissionPercent,
        extraVrplatformReferences: p.extraVrplatformReferences,
      })),
      year,
      months
    );

    const results = await mapWithGuestyConcurrency(checkoutResults, async (r) => {
      if (!r.guestyListingId) {
        return {
          propertyId: r.propertyId,
          reference: r.reference,
          checkoutDates: r.checkoutDates,
          notFoundReferences: r.notFoundReferences,
          cleaningFeeCustomField: null,
          cleaningFeeGuesty: null,
          guestyError: "ID Guesty introuvable pour la référence principale de ce bien.",
        };
      }
      try {
        const prices = await getGuestyCleaningPrices(r.guestyListingId);
        return {
          propertyId: r.propertyId,
          reference: r.reference,
          checkoutDates: r.checkoutDates,
          notFoundReferences: r.notFoundReferences,
          cleaningFeeCustomField: prices.customField,
          cleaningFeeGuesty: prices.standard,
          guestyError: null,
        };
      } catch (err) {
        return {
          propertyId: r.propertyId,
          reference: r.reference,
          checkoutDates: r.checkoutDates,
          notFoundReferences: r.notFoundReferences,
          cleaningFeeCustomField: null,
          cleaningFeeGuesty: null,
          guestyError: err instanceof Error ? err.message : "Erreur Guesty inconnue.",
        };
      }
    });

    return NextResponse.json({ year, months, properties: results });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur inconnue." },
      { status: 502 }
    );
  }
}
