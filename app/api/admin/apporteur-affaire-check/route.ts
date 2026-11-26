import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { isVrPlatformConfigured } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";

// TEMPORAIRE — "Apporteur Affaire" (compte c1484a69-a68b-4b6a-b14f-c61aae6de70b)
// a été ajouté à MANAGER_EXPENSE_ACCOUNT_IDS mais n'apparaît toujours pas dans
// la colonne Dépenses de l'onglet Revenus pour novembre. addListingManagerExpense
// ne garde que party==="manager" et centTotal>0 (lib/vrplatform.ts:956-960,770) —
// ce diagnostic dump TOUTES les écritures brutes de ce compte (party, listingId,
// centTotal, status, date) pour voir laquelle de ces conditions échoue.
const API_BASE_URL = "https://api.vrplatform.app";
const ACCOUNT_ID = "c1484a69-a68b-4b6a-b14f-c61aae6de70b";

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });
  if (!isVrPlatformConfigured()) {
    return NextResponse.json({ error: "VRPlatform n'est pas configuré sur ce déploiement." }, { status: 500 });
  }

  const apiKey = process.env.VRPLATFORM_API_KEY!;
  const teamId = process.env.VRPLATFORM_TEAM_ID!;

  const entries: Record<string, unknown>[] = [];
  let page = 1;
  for (;;) {
    const url = new URL("/reports/journal-entries", API_BASE_URL);
    url.searchParams.set("accountIds", ACCOUNT_ID);
    url.searchParams.set("date", "2026");
    url.searchParams.set("limit", "250");
    url.searchParams.set("page", String(page));
    const res = await fetch(url, { headers: { "x-api-key": apiKey, "x-team-id": teamId }, cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      return NextResponse.json({ error: `VRPlatform ${res.status}`, body }, { status: 502 });
    }
    for (const e of body?.data ?? []) entries.push(e);
    if (page >= (body?.pagination?.totalPage ?? 1)) break;
    page++;
  }

  return NextResponse.json(
    {
      count: entries.length,
      entries: entries.map((e) => ({
        txnAt: e.txnAt,
        party: e.party,
        status: e.status,
        centTotal: e.centTotal,
        listingId: e.listingId,
        description: e.description,
      })),
      firstEntryFullFields: entries[0] ?? null,
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
