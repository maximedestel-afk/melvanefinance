import { NextResponse } from "next/server";
import { getCurrentProfile, listPropertiesForFinance } from "@/lib/queries";
import { listVrPlatformListings } from "@/lib/vrplatform";
import { getGuestyCalendarMonth } from "@/lib/guesty";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// TEMPORAIRE — diagnostic pour vérifier, pour un bien donné, s'il a
// vraiment plusieurs listings VRPlatform (extraVrplatformReferences) comme
// supposé pour expliquer le TR 15-30j à 0% malgré une résa connue (ex:
// 4TOU, 29/10-4/11) — plutôt que de deviner, cette route montre la
// résolution réelle (listings trouvés, IDs Guesty) et le calendrier Guesty
// brut de chacun sur la fenêtre concernée.

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  const searchParams = new URL(request.url).searchParams;
  const reference = searchParams.get("reference");
  if (!reference) {
    return NextResponse.json({ error: "Paramètre 'reference' requis (ex: 4TOU)." }, { status: 400 });
  }

  const [allProperties, allListings] = await Promise.all([listPropertiesForFinance(), listVrPlatformListings()]);
  const property = allProperties.find((p) => p.reference.trim().toLowerCase() === reference.trim().toLowerCase());
  if (!property) {
    return NextResponse.json(
      { error: `Bien "${reference}" introuvable côté Supabase.`, allReferencesSample: allProperties.slice(0, 20).map((p) => p.reference) },
      { status: 404 }
    );
  }

  const listingsByName = new Map(allListings.map((l) => [l.name.trim().toLowerCase(), l]));
  const references = [property.reference, ...property.extraVrplatformReferences];
  const resolved = references.map((ref) => ({
    reference: ref,
    match: listingsByName.get(ref.trim().toLowerCase()) ?? null,
  }));

  const today = new Date();
  const windowAStart = isoDate(today);
  const windowAEnd = isoDate(addDays(today, 14));
  const windowBStart = isoDate(addDays(today, 15));
  const windowBEnd = isoDate(addDays(today, 29));

  const guestyListingIds = resolved.map((r) => r.match?.uniqueRef).filter((id): id is string => !!id);

  const calendars = await Promise.all(
    guestyListingIds.map(async (guestyListingId) => {
      const [daysA, daysB] = await Promise.all([
        getGuestyCalendarMonth(guestyListingId, windowAStart, windowAEnd),
        getGuestyCalendarMonth(guestyListingId, windowBStart, windowBEnd),
      ]);
      return { guestyListingId, windowA: daysA, windowB: daysB };
    })
  );

  return NextResponse.json(
    {
      today: isoDate(today),
      windowA: { start: windowAStart, end: windowAEnd },
      windowB: { start: windowBStart, end: windowBEnd },
      property: {
        reference: property.reference,
        name: property.name,
        extraVrplatformReferences: property.extraVrplatformReferences,
      },
      resolvedListings: resolved.map((r) => ({
        reference: r.reference,
        vrListingId: r.match?.id ?? null,
        vrListingName: r.match?.name ?? null,
        guestyListingId: r.match?.uniqueRef ?? null,
        found: r.match != null,
      })),
      calendars,
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
