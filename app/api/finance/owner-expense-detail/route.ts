import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { getOwnerExpenseEntriesForListing, isVrPlatformConfigured } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Détail écriture par écriture d'une ligne de Dépenses d'un bien —
 * ?listingId=...&accountIds=a,b,c&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD.
 * Onglet "Due to owner", au clic sur une ligne du détail Dépenses. */
export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  if (!isVrPlatformConfigured()) {
    return NextResponse.json({ error: "VRPlatform n'est pas configuré sur ce déploiement." }, { status: 500 });
  }

  const searchParams = new URL(request.url).searchParams;
  const listingId = searchParams.get("listingId");
  const accountIdsParam = searchParams.get("accountIds");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  if (!listingId || !accountIdsParam || !startDate || !endDate) {
    return NextResponse.json(
      { error: "Paramètres 'listingId', 'accountIds', 'startDate' et 'endDate' requis." },
      { status: 400 }
    );
  }
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    return NextResponse.json({ error: "Dates invalides (YYYY-MM-DD)." }, { status: 400 });
  }

  try {
    const entries = await getOwnerExpenseEntriesForListing(
      listingId,
      accountIdsParam.split(",").filter(Boolean),
      `${startDate}...${endDate}`
    );
    return NextResponse.json({ entries }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur VRPlatform inconnue." },
      { status: 502 }
    );
  }
}
