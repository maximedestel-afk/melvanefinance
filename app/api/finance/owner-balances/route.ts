import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import {
  getOwnerBalances,
  getOwnerPayoutDetailsByListing,
  getOwnerStatementListingBreakdown,
  isVrPlatformConfigured,
} from "@/lib/vrplatform";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Solde dû à chaque propriétaire (par bien) à une date donnée —
 * ?date=YYYY-MM-DD. Avec ?activityStartDate=YYYY-MM-DD, ajoute aussi, entre
 * cette date et `date` : le détail des payouts individuels (dates), et le
 * Revenus net propriétaire / Dépenses / Payouts officiels du relevé
 * VRPlatform (voir getOwnerStatementListingBreakdown). Onglet "Due to
 * owner". */
export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  if (!isVrPlatformConfigured()) {
    return NextResponse.json({ error: "VRPlatform n'est pas configuré sur ce déploiement." }, { status: 500 });
  }

  const searchParams = new URL(request.url).searchParams;
  const date = searchParams.get("date");
  if (!date || !DATE_RE.test(date)) {
    return NextResponse.json({ error: "Paramètre 'date' requis (YYYY-MM-DD)." }, { status: 400 });
  }
  const activityStartDate = searchParams.get("activityStartDate");
  if (activityStartDate && !DATE_RE.test(activityStartDate)) {
    return NextResponse.json({ error: "Paramètre 'activityStartDate' invalide (YYYY-MM-DD)." }, { status: 400 });
  }

  try {
    const [balances, payoutDetailsByListing, statementBreakdownByListing] = await Promise.all([
      getOwnerBalances(date),
      activityStartDate ? getOwnerPayoutDetailsByListing(`${activityStartDate}...${date}`) : null,
      activityStartDate ? getOwnerStatementListingBreakdown(`${activityStartDate}...${date}`) : null,
    ]);
    const payoutDetails = payoutDetailsByListing
      ? Array.from(payoutDetailsByListing.entries()).map(([listingId, details]) => ({ listingId, details }))
      : null;
    const statementBreakdown = statementBreakdownByListing
      ? Array.from(statementBreakdownByListing.entries()).map(([listingId, b]) => ({ listingId, ...b }))
      : null;
    return NextResponse.json(
      { balances, payoutDetails, statementBreakdown },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur VRPlatform inconnue." },
      { status: 502 }
    );
  }
}
