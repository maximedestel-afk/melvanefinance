import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { getGuestyListing, isGuestyConfigured } from "@/lib/guesty";

/** Route de diagnostic temporaire — vérifie que les identifiants Guesty et
 * le mapping d'ID (uniqueRef VRPlatform → _id Guesty) fonctionnent. À
 * retirer une fois l'intégration confirmée. */
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
    const listing = await getGuestyListing(id);
    return NextResponse.json({ listing });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur Guesty inconnue." }, { status: 502 });
  }
}
