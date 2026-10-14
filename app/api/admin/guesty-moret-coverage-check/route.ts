import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { getAllGuestyReservationsRaw } from "@/lib/guesty";
import { listAllVrPlatformListingsAnyStatus } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";

// TEMPORAIRE — diagnostic pour vérifier, après correction du filtre de date
// (getAllGuestyReservationsRaw borne désormais sur checkOut via le
// paramètre `filters`, le seul que Guesty applique réellement — un appel
// sans filtre ne renvoie que les réservations à venir, confirmé via l'export
// CSV réel fourni par l'utilisateur), que la couverture est maintenant
// complète. Compare les confirmationCode retrouvés avec un export Guesty.
const MORET_NAME_PATTERN = /moret|8mor/i;

export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  const searchParams = new URL(request.url).searchParams;
  const yearParam = searchParams.get("year");
  const monthParam = searchParams.get("month");
  const year = yearParam ? Number.parseInt(yearParam, 10) : NaN;
  const month = monthParam ? Number.parseInt(monthParam, 10) : NaN;
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "Paramètres 'year' et 'month' (1-12) requis." }, { status: 400 });
  }

  const allListings = await listAllVrPlatformListingsAnyStatus();
  const moretListings = allListings.filter((l) => MORET_NAME_PATTERN.test(l.name) && l.uniqueRef);
  const moretListingIds = new Set(moretListings.map((l) => l.uniqueRef as string));

  const monthStr = String(month).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const allReservations = await getAllGuestyReservationsRaw({
    from: `${year}-${monthStr}-01`,
    to: `${year}-${monthStr}-${String(lastDay).padStart(2, "0")}`,
  });

  const matches = allReservations.filter((r) => {
    const listingId = typeof r.listingId === "string" ? r.listingId : null;
    if (!listingId || !moretListingIds.has(listingId)) return false;
    const checkOut = typeof r.checkOut === "string" ? r.checkOut : null;
    if (!checkOut) return false;
    const d = new Date(checkOut);
    return !Number.isNaN(d.getTime()) && d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month;
  });

  const commissionTotal = matches.reduce((sum, r) => {
    const money = r.money as Record<string, unknown> | undefined;
    return sum + (typeof money?.commission === "number" ? money.commission : 0);
  }, 0);

  return NextResponse.json(
    {
      year,
      month,
      totalReservationsFetchedAccountWide: allReservations.length,
      moretListingCount: moretListings.length,
      matchCount: matches.length,
      commissionTotal: Math.round(commissionTotal * 100) / 100,
      confirmationCodes: matches
        .map((r) => (typeof r.confirmationCode === "string" ? r.confirmationCode : null))
        .filter((c): c is string => c != null)
        .sort(),
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
