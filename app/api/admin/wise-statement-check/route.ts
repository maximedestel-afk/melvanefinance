import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { getWiseBalanceStatementRaw, getWiseBalances, getWiseProfiles, isWiseConfigured, isWiseScaConfigured } from "@/lib/wise";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// TEMPORAIRE — diagnostic pour découvrir en direct la forme de la réponse
// balance-statement (filtrée par compte, mais protégée par SCA) et
// confirmer que la signature RSA passe bien l'approbation. ?balanceId=...
// (voir getWiseBalances pour la liste) sinon prend le premier compte EUR
// trouvé. Relevé sur les 30 derniers jours.
export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });
  if (!isWiseConfigured()) {
    return NextResponse.json({ error: "Wise n'est pas configuré sur ce déploiement (WISE_API_KEY manquant)." }, { status: 500 });
  }
  if (!isWiseScaConfigured()) {
    return NextResponse.json(
      { error: "Clé privée SCA Wise non configurée sur ce déploiement (WISE_SCA_PRIVATE_KEY manquant)." },
      { status: 500 }
    );
  }

  try {
    const profiles = await getWiseProfiles();
    const businessProfile = profiles.find((p) => p.type === "business") ?? profiles[0] ?? null;
    if (!businessProfile) return NextResponse.json({ error: "Aucun profil Wise trouvé pour ce token." }, { status: 404 });

    const balances = await getWiseBalances(businessProfile.id);
    const requestedId = new URL(request.url).searchParams.get("balanceId");
    const balance = requestedId
      ? balances.find((b) => String(b.id) === requestedId)
      : balances.find((b) => b.currency === "EUR");
    if (!balance) {
      return NextResponse.json({ error: "Compte Wise introuvable.", balances }, { status: 404 });
    }

    const now = new Date();
    const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const until = now.toISOString();

    const statement = await getWiseBalanceStatementRaw(businessProfile.id, balance.id, balance.currency, since, until);

    return NextResponse.json(
      { usedBalance: { id: balance.id, name: balance.name, currency: balance.currency }, balances, statement },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur Wise inconnue." },
      { status: 502 }
    );
  }
}
