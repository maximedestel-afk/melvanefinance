import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { getAllGuestyReservationsRaw } from "@/lib/guesty";
import { listAllVrPlatformListingsAnyStatus } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";

// TEMPORAIRE — diagnostic pour découvrir les vrais champs financiers Guesty
// (money.*) disponibles sur une réservation, avant de mapper l'onglet
// Revenus de Moret dessus. À retirer une fois le mapping confirmé.
// Les appartements Moret sont identifiés par leur nom de listing VRPlatform
// ("MORET A1 CV 101", "8MOR SB AC 001"...), pas par un tag Supabase — un
// premier essai filtré sur les listings "active" n'en trouvait aucun, donc
// on cherche ici sur tous statuts et avec un match plus large ("moret"/"8mor"
// n'importe où dans le nom, pas seulement en préfixe).

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  const [allListings, allGuestyReservations] = await Promise.all([
    listAllVrPlatformListingsAnyStatus(),
    getAllGuestyReservationsRaw(),
  ]);

  const moretListings = allListings.filter((l) => /moret|8mor/i.test(l.name));

  const listings = moretListings.map((listing) => {
    const sampleReservations = listing.uniqueRef
      ? allGuestyReservations.filter((r) => r.listingId === listing.uniqueRef).slice(0, 2)
      : [];
    return {
      vrListingId: listing.id,
      name: listing.name,
      status: listing.status,
      guestyListingId: listing.uniqueRef,
      sampleReservationCount: sampleReservations.length,
      sampleReservations,
    };
  });

  return NextResponse.json(
    {
      totalListingsScanned: allListings.length,
      totalMoretListings: moretListings.length,
      listings,
      // Si toujours 0 malgré le match large, échantillon de noms pour
      // repérer un éventuel problème d'orthographe/format du nom.
      sampleOfAllNames: moretListings.length === 0 ? allListings.slice(0, 30).map((l) => l.name) : undefined,
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
