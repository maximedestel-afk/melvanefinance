import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { getGuestyReservationsRaw } from "@/lib/guesty";

export const dynamic = "force-dynamic";

// Diagnostic temporaire (à retirer) — comparaison Guesty vs VRPlatform.
export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  const guestyListingId = new URL(request.url).searchParams.get("guestyListingId");
  if (!guestyListingId) return NextResponse.json({ error: "guestyListingId manquant." }, { status: 400 });

  try {
    const data = await getGuestyReservationsRaw(guestyListingId);
    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur Guesty inconnue." }, { status: 502 });
  }
}
