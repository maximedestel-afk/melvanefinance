import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { isVrPlatformConfigured } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// TEMPORAIRE — /api/finance/contacts renvoie une liste vide : on suppose
// {data: [{id, name, email}], pagination} par analogie avec /accounts, mais
// le vrai format n'a jamais été vérifié en direct (sandbox sans accès
// réseau VRPlatform). Ce diagnostic renvoie la réponse brute de /contacts
// (et quelques variantes de paramètres) pour voir la vraie forme.
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
    ["contacts_no_params", "/contacts", {}],
    ["contacts_limit", "/contacts", { limit: "5" }],
    ["contacts_limit_page", "/contacts", { limit: "5", page: "1" }],
  ];
  for (const [key, path, query] of candidates) {
    try {
      attempts[key] = await vrPlatformFetchRaw(path, query);
    } catch (err) {
      attempts[key] = { error: err instanceof Error ? err.message : "Erreur inconnue." };
    }
  }

  return NextResponse.json({ attempts }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
