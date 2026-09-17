import { NextResponse } from "next/server";
import { getCurrentProfile, listPropertiesForFinance } from "@/lib/queries";
import { getPropertyOccupancyForMonth, isVrPlatformConfigured } from "@/lib/vrplatform";

export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  if (!isVrPlatformConfigured()) {
    return NextResponse.json({ error: "VRPlatform n'est pas configuré sur ce déploiement." }, { status: 500 });
  }

  const searchParams = new URL(request.url).searchParams;
  const year = Number.parseInt(searchParams.get("year") ?? "", 10);
  const month = Number.parseInt(searchParams.get("month") ?? "", 10);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "Mois invalide." }, { status: 400 });
  }

  try {
    const properties = await listPropertiesForFinance();
    const results = await getPropertyOccupancyForMonth(
      properties.map((p) => ({
        propertyId: p.id,
        reference: p.reference,
        name: p.name,
        rentType: p.rentType,
        rentAmount: p.rentAmount,
        extraVrplatformReferences: p.extraVrplatformReferences,
      })),
      year,
      month
    );
    return NextResponse.json({ year, month, properties: results });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur VRPlatform inconnue." },
      { status: 502 }
    );
  }
}
