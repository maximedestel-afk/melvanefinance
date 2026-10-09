import { NextResponse } from "next/server";
import { getCurrentProfile, listPropertiesForFinance } from "@/lib/queries";
import { getPortfolioGuestyListingIds, isVrPlatformConfigured } from "@/lib/vrplatform";
import { getGuestyCleaningPrices, isGuestyConfigured, mapWithGuestyConcurrency } from "@/lib/guesty";

export const dynamic = "force-dynamic";

/** Prix de ménage (custom field + standard Guesty) de chaque bien, sans
 * dépendre d'une période ni de check-outs — contrairement à
 * /api/finance/cleaning, qui ne liste un bien que s'il a eu un check-out
 * dans la période demandée. Utile pour une simple liste de prix configurés,
 * indépendamment des réservations. */
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
  const propertyIdsParam = searchParams.get("propertyIds");
  const propertyIds = propertyIdsParam ? new Set(propertyIdsParam.split(",")) : null;

  try {
    const allProperties = await listPropertiesForFinance();
    const properties = propertyIds ? allProperties.filter((p) => propertyIds.has(p.id)) : allProperties;
    if (propertyIds && properties.length === 0) {
      return NextResponse.json({ error: "Aucun bien ne correspond aux filtres." }, { status: 404 });
    }

    const guestyListingIdByProperty = await getPortfolioGuestyListingIds(
      properties.map((p) => ({
        propertyId: p.id,
        reference: p.reference,
        name: p.name,
        rentType: p.rentType,
        rentAmount: p.rentAmount,
        commissionPercent: p.commissionPercent,
        extraVrplatformReferences: p.extraVrplatformReferences,
      }))
    );

    const results = await mapWithGuestyConcurrency(properties, async (p) => {
      const guestyListingId = guestyListingIdByProperty.get(p.id) ?? null;
      if (!guestyListingId) {
        return {
          propertyId: p.id,
          reference: p.reference,
          cleaningProviderName: p.cleaningProviderName,
          cleaningFeeCustomField: null,
          cleaningFeeGuesty: null,
          guestyError: "ID Guesty introuvable pour la référence principale de ce bien.",
        };
      }
      try {
        const prices = await getGuestyCleaningPrices(guestyListingId);
        return {
          propertyId: p.id,
          reference: p.reference,
          cleaningProviderName: p.cleaningProviderName,
          cleaningFeeCustomField: prices.customField,
          cleaningFeeGuesty: prices.standard,
          guestyError: null,
        };
      } catch (err) {
        return {
          propertyId: p.id,
          reference: p.reference,
          cleaningProviderName: p.cleaningProviderName,
          cleaningFeeCustomField: null,
          cleaningFeeGuesty: null,
          guestyError: err instanceof Error ? err.message : "Erreur Guesty inconnue.",
        };
      }
    });

    return NextResponse.json({ properties: results }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur inconnue." }, { status: 502 });
  }
}
