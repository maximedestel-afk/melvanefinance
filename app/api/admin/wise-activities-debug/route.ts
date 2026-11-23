import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { isWiseConfigured } from "@/lib/wise";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// TEMPORAIRE — le 400 (sans corps) sur /v1/profiles/{id}/activities ne dit
// pas quel paramètre pose problème. Essaie plusieurs variantes de requête
// et renvoie le statut + corps de chacune, pour isoler la cause en un seul
// aller-retour plutôt que par itérations.
const API_BASE_URL = "https://api.wise.com";
const PROFILE_ID = "13136713";

async function tryCall(label: string, query: Record<string, string>): Promise<Record<string, unknown>> {
  const apiKey = process.env.WISE_API_KEY!;
  const url = new URL(`/v1/profiles/${PROFILE_ID}/activities`, API_BASE_URL);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` }, cache: "no-store" });
    const body = await res.text().catch(() => "");
    return { label, url: `${url.pathname}${url.search}`, status: res.status, body: body.slice(0, 500) || null };
  } catch (err) {
    return { label, url: `${url.pathname}${url.search}`, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });
  if (!isWiseConfigured()) {
    return NextResponse.json({ error: "Wise n'est pas configuré sur ce déploiement (WISE_API_KEY manquant)." }, { status: 500 });
  }

  const since = "2026-10-24T00:00:00.000Z";
  const until = "2026-11-23T23:59:59.999Z";
  const shortSince = "2026-11-20T00:00:00.000Z";

  const results = await Promise.all([
    tryCall("sans aucun param", {}),
    tryCall("since+until seuls", { since, until }),
    tryCall("since+until+size=10", { since, until, size: "10" }),
    tryCall("since+until+size=200", { since, until, size: "200" }),
    tryCall("since+until courts (3 jours)", { since: shortSince, until }),
    tryCall("since+until+monetaryResourceType=TRANSFER", { since, until, monetaryResourceType: "TRANSFER" }),
    tryCall("size=10 seul", { size: "10" }),
  ]);

  return NextResponse.json({ results }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
