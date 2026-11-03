import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { isVrPlatformConfigured } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// TEMPORAIRE — diagnostic : le bouton "Rapprocher" de l'onglet Factures ne
// trouve pas une transaction dont l'utilisateur confirme qu'elle existe à
// exactement -4225,00€ ("Sweep It - New Flat Set Up et Periodic Au dit
// octobre 2026"). Cherche cette transaction directement par texte
// (search=...) pour voir son champ `amount` brut tel que l'API le renvoie,
// et compare côte à côte avec une recherche par ?amount=-422500 pour voir
// où ça coince (unité, signe, format du paramètre...).
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

  const searchParams = new URL(request.url).searchParams;
  const amountCents = Number.parseInt(searchParams.get("amountCents") ?? "422500", 10);
  const search = searchParams.get("search") ?? "New Flat Set Up";

  const attempts: Record<string, unknown> = {};
  const candidates: [string, string, Record<string, string>][] = [
    ["by_search_text", "/transactions", { limit: "10", search }],
    ["by_amount_negative", "/transactions", { limit: "10", amount: String(-Math.abs(amountCents)) }],
    ["by_amount_negative_as_euros", "/transactions", { limit: "10", amount: String(-Math.abs(amountCents) / 100) }],
    ["by_amount_positive", "/transactions", { limit: "10", amount: String(Math.abs(amountCents)) }],
  ];

  for (const [key, path, query] of candidates) {
    try {
      attempts[key] = await vrPlatformFetchRaw(path, query);
    } catch (err) {
      attempts[key] = { error: err instanceof Error ? err.message : "Erreur inconnue." };
    }
  }

  return NextResponse.json({ amountCents, search, attempts }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
