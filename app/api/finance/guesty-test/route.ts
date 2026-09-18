import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { getGuestyListing, getPropertyCustomFieldValues, isGuestyConfigured } from "@/lib/guesty";

/** Route de diagnostic temporaire — inspecte les données brutes renvoyées
 * par Guesty pour un listing donné (prix + custom fields). À retirer une
 * fois le bug confirmé/corrigé. */
export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  if (!isGuestyConfigured()) {
    return NextResponse.json({ error: "Guesty n'est pas configuré sur ce déploiement." }, { status: 500 });
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Paramètre ?id= manquant (uniqueRef VRPlatform du listing)." }, { status: 400 });
  }

  try {
    const [listing, customFields] = await Promise.all([getGuestyListing(id), getPropertyCustomFieldValues(id)]);
    return NextResponse.json({ listing, customFields });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur Guesty inconnue." }, { status: 502 });
  }
}
