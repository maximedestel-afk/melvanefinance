import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { getAllGuestyReservationsRaw } from "@/lib/guesty";
import { listVrPlatformListings } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";

// TEMPORAIRE — diagnostic pour découvrir les vrais champs financiers Guesty
// (money.*) disponibles sur une réservation, avant de mapper l'onglet
// Revenus de Moret dessus. À retirer une fois le mapping confirmé.
// Les appartements Moret sont identifiés par leur nom de listing VRPlatform
// (préfixe "MORET" ou "8MOR"), pas par un tag Supabase — cf. liste donnée
// par l'utilisateur (ex: "MORET A1 CV 101", "8MOR SB AC 001"...).

const MORET_NAME_PATTERN = /^(moret|8mor)/i;

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  const [allListings, allGuestyReservations] = await Promise.all([
    listVrPlatformListings(),
    getAllGuestyReservationsRaw(),
  ]);

  const moretListings = allListings.filter((l) => MORET_NAME_PATTERN.test(l.name.trim()));

  const listings = moretListings.map((listing) => {
    const sampleReservations = listing.uniqueRef
      ? allGuestyReservations.filter((r) => r.listingId === listing.uniqueRef).slice(0, 2)
      : [];
    return {
      vrListingId: listing.id,
      name: listing.name,
      guestyListingId: listing.uniqueRef,
      sampleReservationCount: sampleReservations.length,
      sampleReservations,
    };
  });

  return NextResponse.json(
    { totalMoretListings: moretListings.length, listings },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
