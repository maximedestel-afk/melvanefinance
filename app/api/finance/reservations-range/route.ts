import { NextResponse } from "next/server";
import { getCurrentProfile, listPropertiesForFinance } from "@/lib/queries";
import { getPropertyReservationDetailsForDateRange, isVrPlatformConfigured } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Version "plage de dates" de /api/finance/reservations — réservations
 * dont le check-out tombe dans [startDate, endDate] (inclus), pour un seul
 * bien. Utilisé par l'onglet Analyse en mode plage de dates. */
export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });
  if (!isVrPlatformConfigured()) {
    return NextResponse.json({ error: "VRPlatform n'est pas configuré sur ce déploiement." }, { status: 500 });
  }

  const searchParams = new URL(request.url).searchParams;
  const propertyId = searchParams.get("propertyId");
  const startDate = searchParams.get("startDate") ?? "";
  const endDate = searchParams.get("endDate") ?? "";
  if (!propertyId || !DATE_RE.test(startDate) || !DATE_RE.test(endDate) || startDate > endDate) {
    return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });
  }

  try {
    const allProperties = await listPropertiesForFinance();
    const property = allProperties.find((p) => p.id === propertyId);
    if (!property) return NextResponse.json({ error: "Bien introuvable." }, { status: 404 });

    const reservations = await getPropertyReservationDetailsForDateRange(
      {
        propertyId: property.id,
        reference: property.reference,
        name: property.name,
        rentType: property.rentType,
        rentAmount: property.rentAmount,
        commissionPercent: property.commissionPercent,
        extraVrplatformReferences: property.extraVrplatformReferences,
      },
      startDate,
      endDate
    );

    return NextResponse.json(
      { reference: property.reference, reservations },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur VRPlatform inconnue." },
      { status: 502 }
    );
  }
}
