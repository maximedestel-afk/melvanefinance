import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { getGuestyMonthlyFinancials } from "@/lib/guesty";
import { listAllVrPlatformListingsAnyStatus } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";

// Les listings VRPlatform de Moret sont tous "inactive" (switch de PMS) donc
// invisibles au calcul financier habituel (basé sur VRPlatform) — pour ce
// bien, et seulement pour celui-ci, l'onglet Revenus va chercher Rents/
// Channel fees/Net Revenue/Commission directement dans Guesty. Identifié par
// le nom du listing VRPlatform ("MORET A1 CV 101", "8MOR SB AC 001"...), pas
// par un tag Supabase.
const MORET_NAME_PATTERN = /moret|8mor/i;

export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  const searchParams = new URL(request.url).searchParams;
  const yearParam = searchParams.get("year");
  const year = yearParam ? Number.parseInt(yearParam, 10) : NaN;
  if (!Number.isInteger(year)) {
    return NextResponse.json({ error: "Année invalide." }, { status: 400 });
  }

  try {
    const allListings = await listAllVrPlatformListingsAnyStatus();
    const moretListingIds = allListings
      .filter((l) => MORET_NAME_PATTERN.test(l.name))
      .map((l) => l.uniqueRef)
      .filter((id): id is string => !!id);
    const months = await getGuestyMonthlyFinancials(moretListingIds, year);
    return NextResponse.json({ year, months }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur Guesty inconnue." },
      { status: 502 }
    );
  }
}
