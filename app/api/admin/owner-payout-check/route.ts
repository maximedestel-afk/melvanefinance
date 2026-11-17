import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { isVrPlatformConfigured } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";

// TEMPORAIRE — diagnostic pour voir les champs bruts de /reports/journal-entries
// d'un payout donné (txnCode, ex: PAY-202611-S784T) : account.name,
// entityType, party, listingId, centTotal — pour comprendre pourquoi
// getOwnerBalanceActivityByListing (lib/vrplatform.ts) ne le compte pas dans
// Payouts. Voir app/DueToOwnerTable.tsx.
const API_BASE_URL = "https://api.vrplatform.app";

async function vrPlatformFetchRaw(path: string, query: Record<string, string>): Promise<unknown> {
  const apiKey = process.env.VRPLATFORM_API_KEY;
  const teamId = process.env.VRPLATFORM_TEAM_ID;
  if (!apiKey || !teamId) throw new Error("VRPlatform n'est pas configuré.");
  const url = new URL(path, API_BASE_URL);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { "x-api-key": apiKey, "x-team-id": teamId }, cache: "no-store" });
  if (!response.ok) throw new Error(`VRPlatform a répondu ${response.status} sur ${path}.`);
  return response.json();
}

export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });
  if (!isVrPlatformConfigured()) {
    return NextResponse.json({ error: "VRPlatform n'est pas configuré sur ce déploiement." }, { status: 500 });
  }

  const txnCode = new URL(request.url).searchParams.get("txnCode");
  if (!txnCode) return NextResponse.json({ error: "Paramètre 'txnCode' requis." }, { status: 400 });

  try {
    const journalEntriesNoPartyFilter = await vrPlatformFetchRaw("/reports/journal-entries", {
      txnCode,
      limit: "50",
    });
    const journalEntriesOwnersParty = await vrPlatformFetchRaw("/reports/journal-entries", {
      txnCode,
      party: "owners",
      limit: "50",
    });

    return NextResponse.json(
      { txnCode, journalEntriesNoPartyFilter, journalEntriesOwnersParty },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur inconnue." }, { status: 502 });
  }
}
