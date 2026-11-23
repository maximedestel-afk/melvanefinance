import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { getWiseActivities, getWiseBalances, getWiseProfiles, isWiseConfigured } from "@/lib/wise";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// TEMPORAIRE — diagnostic pour découvrir en direct la forme des réponses
// Wise (profils, soldes, activités) avant de construire l'intégration
// définitive (doit remplacer l'import CSV manuel du Relevé Bancaire). Dump
// brut des 3 appels pour le premier profil business trouvé.
export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });
  if (!isWiseConfigured()) {
    return NextResponse.json({ error: "Wise n'est pas configuré sur ce déploiement (WISE_API_KEY manquant)." }, { status: 500 });
  }

  try {
    const profiles = await getWiseProfiles();
    const businessProfile = profiles.find((p) => p.type === "business") ?? profiles[0] ?? null;
    if (!businessProfile) {
      return NextResponse.json({ error: "Aucun profil Wise trouvé pour ce token.", profiles }, { status: 404 });
    }

    const now = new Date();
    const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const until = now.toISOString();

    const [balances, activitiesResult] = await Promise.allSettled([
      getWiseBalances(businessProfile.id),
      getWiseActivities(businessProfile.id, since, until, 20),
    ]);

    return NextResponse.json(
      {
        profiles,
        usedProfileId: businessProfile.id,
        balances: balances.status === "fulfilled" ? balances.value : { error: String(balances.reason) },
        activities: activitiesResult.status === "fulfilled" ? activitiesResult.value : { error: String(activitiesResult.reason) },
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur Wise inconnue." },
      { status: 502 }
    );
  }
}
