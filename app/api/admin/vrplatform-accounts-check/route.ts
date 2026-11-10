import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { isVrPlatformConfigured } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// TEMPORAIRE — on ne sait pas encore quel filtre /accounts donne exactement
// les comptes de dépense (Housekeeping, Tech, Staff...) sans les comptes
// hors dépenses (Accounts Payable...). classification=expense+type=ledger
// excluait Housekeeping ; sans filtre du tout, Accounts Payable apparaît.
// Ce diagnostic renvoie TOUS les comptes actifs avec leurs champs bruts
// (classification, type...) pour trouver le bon filtre une bonne fois.
const API_BASE_URL = "https://api.vrplatform.app";

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });
  if (!isVrPlatformConfigured()) {
    return NextResponse.json({ error: "VRPlatform n'est pas configuré sur ce déploiement." }, { status: 500 });
  }

  const apiKey = process.env.VRPLATFORM_API_KEY!;
  const teamId = process.env.VRPLATFORM_TEAM_ID!;

  const accounts: Record<string, unknown>[] = [];
  let page = 1;
  for (;;) {
    const url = new URL("/accounts", API_BASE_URL);
    url.searchParams.set("status", "active");
    url.searchParams.set("limit", "250");
    url.searchParams.set("page", String(page));
    const res = await fetch(url, { headers: { "x-api-key": apiKey, "x-team-id": teamId }, cache: "no-store" });
    const body = await res.json().catch(() => null);
    for (const a of body?.data ?? []) accounts.push(a);
    if (page >= (body?.pagination?.totalPage ?? 1)) break;
    page++;
  }

  return NextResponse.json(
    {
      count: accounts.length,
      // Juste id/name/classification/type pour que ce soit lisible — le
      // reste des champs bruts d'un seul compte à titre d'exemple.
      accounts: accounts.map((a) => ({
        id: a.id,
        name: a.name,
        classification: a.classification,
        type: a.type,
      })),
      firstAccountFullFields: accounts[0] ?? null,
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
