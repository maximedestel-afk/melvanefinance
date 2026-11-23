import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { getAllGuestyReservationsRaw, getGuestyListing } from "@/lib/guesty";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// TEMPORAIRE — diagnostic ponctuel : réservations Guesty "owner" (source
// "owner" ou "owner-guest") avec check-out dans le mois demandé — pas de
// filtre dédié dans l'app, demandé à la volée. ?year=2026&month=11
// (défaut : novembre 2026).
export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  const searchParams = new URL(request.url).searchParams;
  const year = Number.parseInt(searchParams.get("year") ?? "2026", 10);
  const month = Number.parseInt(searchParams.get("month") ?? "11", 10);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "Paramètres 'year' et 'month' (1-12) invalides." }, { status: 400 });
  }

  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  try {
    const reservations = await getAllGuestyReservationsRaw({ from, to });
    const ownerReservations = reservations.filter((r) => {
      const source = typeof r.source === "string" ? r.source.toLowerCase() : "";
      return source === "owner" || source === "owner-guest";
    });

    const listingIds = Array.from(
      new Set(ownerReservations.map((r) => r.listingId).filter((id): id is string => typeof id === "string"))
    );
    const listingTitleById = new Map<string, string>();
    await Promise.all(
      listingIds.map(async (id) => {
        try {
          const listing = await getGuestyListing(id, ["title", "nickname"]);
          listingTitleById.set(id, listing.nickname || listing.title || id);
        } catch {
          listingTitleById.set(id, id);
        }
      })
    );

    const results = ownerReservations
      .map((r) => ({
        listing: listingTitleById.get(r.listingId as string) ?? (r.listingId as string),
        source: r.source,
        status: r.status,
        confirmationCode: r.confirmationCode,
        checkIn: r.checkIn,
        checkOut: r.checkOut,
        guestName: (r.guest as { fullName?: string } | undefined)?.fullName ?? null,
      }))
      .sort((a, b) => String(a.checkOut).localeCompare(String(b.checkOut)));

    return NextResponse.json(
      { year, month, from, to, count: results.length, reservations: results },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur Guesty inconnue." },
      { status: 502 }
    );
  }
}
