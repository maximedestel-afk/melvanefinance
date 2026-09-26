import { NextResponse } from "next/server";
import { getCurrentProfile, listPropertiesForFinance } from "@/lib/queries";
import { getPropertyReservationDetails, isVrPlatformConfigured } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });
  if (!isVrPlatformConfigured()) {
    return NextResponse.json({ error: "VRPlatform n'est pas configuré sur ce déploiement." }, { status: 500 });
  }

  const searchParams = new URL(request.url).searchParams;
  const propertyId = searchParams.get("propertyId");
  const year = Number.parseInt(searchParams.get("year") ?? "", 10);
  const months = (searchParams.get("months") ?? "")
    .split(",")
    .map((m) => Number.parseInt(m, 10))
    .filter((m) => Number.isInteger(m) && m >= 1 && m <= 12);
  if (!propertyId || !Number.isInteger(year) || months.length === 0) {
    return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });
  }

  try {
    const allProperties = await listPropertiesForFinance();
    const property = allProperties.find((p) => p.id === propertyId);
    if (!property) return NextResponse.json({ error: "Bien introuvable." }, { status: 404 });

    const reservations = await getPropertyReservationDetails(
      {
        propertyId: property.id,
        reference: property.reference,
        name: property.name,
        rentType: property.rentType,
        rentAmount: property.rentAmount,
        commissionPercent: property.commissionPercent,
        extraVrplatformReferences: property.extraVrplatformReferences,
      },
      year,
      months
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
