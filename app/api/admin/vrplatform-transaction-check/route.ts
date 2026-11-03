import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { isVrPlatformConfigured } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// TEMPORAIRE — "New Flat Set Up" dans /transactions ce sont 13 lignes
// individuelles à -250,00€ chacune, pas le -4225,00€ vu dans une vue
// "Matched" (relevé bancaire). Le 4225€ n'existe qu'au niveau d'un
// enregistrement BANCAIRE agrégé (payment.bankRecordIds le confirme sur
// chaque transaction), une ressource différente de /transactions. Liste TOUS
// les chemins de l'OpenAPI spec (pas seulement transaction/contact/payment/
// bill) pour trouver cette ressource, et tente de lire un bankRecordId déjà
// connu directement.
const API_BASE_URL = "https://api.vrplatform.app";

async function vrPlatformFetchRaw(path: string, query: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
  const apiKey = process.env.VRPLATFORM_API_KEY;
  const teamId = process.env.VRPLATFORM_TEAM_ID;
  if (!apiKey || !teamId) throw new Error("VRPlatform n'est pas configuré.");
  const url = new URL(path, API_BASE_URL);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { "x-api-key": apiKey, "x-team-id": teamId }, cache: "no-store" });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });
  if (!isVrPlatformConfigured()) {
    return NextResponse.json({ error: "VRPlatform n'est pas configuré sur ce déploiement." }, { status: 500 });
  }

  const bankRecordId = new URL(request.url).searchParams.get("bankRecordId") ?? "555080b6-5657-4cad-8d1c-1671c81a4ceb";

  let allPaths: string[] = [];
  try {
    const specRes = await fetch("https://eu.api.vrplatform.app/openapi.json", { cache: "no-store" });
    const spec = await specRes.json();
    allPaths = Object.keys(spec?.paths ?? {}).sort();
  } catch (err) {
    allPaths = [`error: ${err instanceof Error ? err.message : "Erreur inconnue."}`];
  }

  const attempts: Record<string, unknown> = {};
  const candidates: [string, string, Record<string, string>][] = [
    ["get_bank_record_by_id", `/bank-records/${bankRecordId}`, {}],
    ["get_bank_record_alt", `/bank-feed/records/${bankRecordId}`, {}],
    ["list_bank_records", "/bank-records", { limit: "5" }],
  ];
  for (const [key, path, query] of candidates) {
    try {
      attempts[key] = await vrPlatformFetchRaw(path, query);
    } catch (err) {
      attempts[key] = { error: err instanceof Error ? err.message : "Erreur inconnue." };
    }
  }

  return NextResponse.json(
    { bankRecordId, allPathsContainingBank: allPaths.filter((p) => /bank|record|reconcil|feed/i.test(p)), allPaths, attempts },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
