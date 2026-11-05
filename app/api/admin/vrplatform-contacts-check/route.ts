import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { isVrPlatformConfigured } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// TEMPORAIRE — le format exact de /contacts (noms de champs, et surtout un
// champ type/category distinguant les "Vendors" des autres contacts
// propriétaires/invités) n'a jamais été vérifié en direct (sandbox sans
// accès réseau VRPlatform). Ce diagnostic renvoie la réponse brute de
// /contacts avec quelques variantes de filtre pour trouver le bon champ et
// la bonne valeur à utiliser pour ne garder que les Vendors.
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

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });
  if (!isVrPlatformConfigured()) {
    return NextResponse.json({ error: "VRPlatform n'est pas configuré sur ce déploiement." }, { status: 500 });
  }

  const attempts: Record<string, unknown> = {};
  const candidates: [string, string, Record<string, string>][] = [
    ["contacts_sample", "/contacts", { limit: "20" }],
    ["contacts_type_vendor", "/contacts", { limit: "5", type: "vendor" }],
    ["contacts_category_vendor", "/contacts", { limit: "5", category: "vendor" }],
    ["contacts_role_vendor", "/contacts", { limit: "5", role: "vendor" }],
  ];
  for (const [key, path, query] of candidates) {
    try {
      attempts[key] = await vrPlatformFetchRaw(path, query);
    } catch (err) {
      attempts[key] = { error: err instanceof Error ? err.message : "Erreur inconnue." };
    }
  }

  // Liste tous les noms de champs distincts vus sur le premier contact de
  // contacts_sample, pour repérer d'un coup d'œil où se trouve un éventuel
  // type/catégorie (ex: "type", "category", "isVendor", "role"...).
  const sample = attempts.contacts_sample as { status: number; body: unknown } | undefined;
  const firstContact =
    sample && typeof sample.body === "object" && sample.body !== null && "data" in sample.body
      ? (sample.body as { data: unknown[] }).data?.[0]
      : null;
  const firstContactFieldNames = firstContact && typeof firstContact === "object" ? Object.keys(firstContact) : [];

  return NextResponse.json(
    { firstContactFieldNames, attempts },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
