import { NextResponse } from "next/server";
import { getCurrentProfile, listPropertiesForFinance } from "@/lib/queries";
import { getYearlyTotals, isVrPlatformConfigured } from "@/lib/vrplatform";

export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  if (!isVrPlatformConfigured()) {
    return NextResponse.json({ error: "VRPlatform n'est pas configuré sur ce déploiement." }, { status: 500 });
  }

  const searchParams = new URL(request.url).searchParams;
  const years = (searchParams.get("years") ?? "")
    .split(",")
    .map((y) => Number.parseInt(y.trim(), 10))
    .filter((y) => Number.isInteger(y));
  if (years.length === 0) {
    return NextResponse.json({ error: "Années invalides." }, { status: 400 });
  }

  const propertyId = searchParams.get("propertyId");

  try {
    const allProperties = await listPropertiesForFinance();
    const properties = propertyId ? allProperties.filter((p) => p.id === propertyId) : allProperties;
    if (propertyId && properties.length === 0) {
      return NextResponse.json({ error: "Bien introuvable." }, { status: 404 });
    }

    const totals = await getYearlyTotals(
      properties.map((p) => ({
        propertyId: p.id,
        reference: p.reference,
        name: p.name,
        rentType: p.rentType,
        rentAmount: p.rentAmount,
        extraVrplatformReferences: p.extraVrplatformReferences,
      })),
      years
    );
    return NextResponse.json({ years: totals });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur VRPlatform inconnue." },
      { status: 502 }
    );
  }
}
