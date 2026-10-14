import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { getGuestyMonthlyFinancialsByListing } from "@/lib/guesty";
import { listAllVrPlatformListingsAnyStatus } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";
// Récupérer les réservations Guesty de tout le compte (pas seulement
// Moret — l'API ignore listingId= côté serveur) peut prendre du temps sur
// une large fenêtre ; on la limite déjà aux mois demandés, mais on garde
// de la marge sur la durée de la fonction au cas où.
export const maxDuration = 60;

// Les listings VRPlatform de Moret sont tous "inactive" (switch de PMS) donc
// invisibles au calcul financier habituel (basé sur VRPlatform) — pour ce
// bien, et seulement pour celui-ci, l'onglet Revenus va chercher Rents/
// Channel fees/Net Revenue/Commission directement dans Guesty. Identifié par
// le nom du listing VRPlatform ("MORET A1 CV 101", "8MOR SB AC 001"...), pas
// par un tag Supabase. Chaque appartement Moret est son propre bien côté
// Supabase (référence = nom du listing), donc la réponse reste par listing —
// jamais agrégée entre appartements.
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
  const monthsParam = searchParams.get("months");
  const requestedMonths = monthsParam
    ? monthsParam
        .split(",")
        .map((m) => Number.parseInt(m, 10))
        .filter((m) => Number.isInteger(m) && m >= 1 && m <= 12)
    : undefined;

  try {
    const allListings = await listAllVrPlatformListingsAnyStatus();
    const moretListings = allListings.filter((l) => MORET_NAME_PATTERN.test(l.name) && l.uniqueRef);
    const guestyListingIds = moretListings.map((l) => l.uniqueRef as string);
    const monthsByListingId = await getGuestyMonthlyFinancialsByListing(guestyListingIds, year, requestedMonths);

    const listings = moretListings.map((l) => ({
      name: l.name,
      months: monthsByListingId.get(l.uniqueRef as string) ?? [],
    }));

    return NextResponse.json({ year, listings }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur Guesty inconnue." },
      { status: 502 }
    );
  }
}
