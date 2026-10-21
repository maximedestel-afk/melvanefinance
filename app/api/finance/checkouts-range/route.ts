import { NextResponse } from "next/server";
import { getCurrentProfile, listPropertiesForFinance } from "@/lib/queries";
import { getPropertyCheckoutsForDateRange, isVrPlatformConfigured } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Dates de check-out dans [startDate, endDate] (inclus) pour chaque bien —
 * sans les prix de ménage Guesty (contrairement à /api/finance/cleaning[-range]),
 * juste la liste brute. Utilisé par l'onglet Ménages à faire. */
export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });
  if (!isVrPlatformConfigured()) {
    return NextResponse.json({ error: "VRPlatform n'est pas configuré sur ce déploiement." }, { status: 500 });
  }

  const searchParams = new URL(request.url).searchParams;
  const startDate = searchParams.get("startDate") ?? "";
  const endDate = searchParams.get("endDate") ?? "";
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate) || startDate > endDate) {
    return NextResponse.json({ error: "Plage de dates invalide." }, { status: 400 });
  }

  const propertyIdsParam = searchParams.get("propertyIds");
  const propertyIds = propertyIdsParam ? new Set(propertyIdsParam.split(",")) : null;

  try {
    const allProperties = await listPropertiesForFinance();
    const properties = propertyIds ? allProperties.filter((p) => propertyIds.has(p.id)) : allProperties;
    if (propertyIds && properties.length === 0) {
      return NextResponse.json({ error: "Aucun bien ne correspond aux filtres." }, { status: 404 });
    }

    const results = await getPropertyCheckoutsForDateRange(
      properties.map((p) => ({
        propertyId: p.id,
        reference: p.reference,
        name: p.name,
        rentType: p.rentType,
        rentAmount: p.rentAmount,
        commissionPercent: p.commissionPercent,
        extraVrplatformReferences: p.extraVrplatformReferences,
      })),
      startDate,
      endDate
    );

    return NextResponse.json(
      {
        startDate,
        endDate,
        properties: results.map((r) => ({
          propertyId: r.propertyId,
          reference: r.reference,
          checkoutDates: r.checkoutDates,
          notFoundReferences: r.notFoundReferences,
        })),
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur inconnue." },
      { status: 502 }
    );
  }
}
