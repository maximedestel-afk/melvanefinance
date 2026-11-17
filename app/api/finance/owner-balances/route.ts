import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { getOwnerBalances, isVrPlatformConfigured } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Solde dû à chaque propriétaire (par bien) à une date donnée —
 * ?date=YYYY-MM-DD. Onglet "Due to owner". */
export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  if (!isVrPlatformConfigured()) {
    return NextResponse.json({ error: "VRPlatform n'est pas configuré sur ce déploiement." }, { status: 500 });
  }

  const date = new URL(request.url).searchParams.get("date");
  if (!date || !DATE_RE.test(date)) {
    return NextResponse.json({ error: "Paramètre 'date' requis (YYYY-MM-DD)." }, { status: 400 });
  }

  try {
    const balances = await getOwnerBalances(date);
    return NextResponse.json({ balances }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur VRPlatform inconnue." },
      { status: 502 }
    );
  }
}
