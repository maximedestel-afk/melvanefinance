import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { isVrPlatformConfigured } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";

// TEMPORAIRE — diagnostic pour voir tous les types de ligne de réservation
// VRPlatform et leur compte comptable associé (Réglages > Reservation Line
// Mappings), afin de trouver le nom exact du compte "Ménage"/"Cleaning" à
// ajouter à classifyReservationLines (lib/vrplatform.ts) à côté de Rents/
// Channel Commissions/City Taxes — avant ça on ne connaît que ces trois-là.
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

interface LineMappingsResponse {
  data: { type: string; account: { name: string } | null }[];
  pagination: { page: number; totalPage: number };
}

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });
  if (!isVrPlatformConfigured()) {
    return NextResponse.json({ error: "VRPlatform n'est pas configuré sur ce déploiement." }, { status: 500 });
  }

  try {
    const mappings: { type: string; accountName: string | null }[] = [];
    let page = 1;
    for (;;) {
      const res = (await vrPlatformFetchRaw("/reservations/line-mappings", { limit: "250", page: String(page) })) as LineMappingsResponse;
      for (const m of res.data) mappings.push({ type: m.type, accountName: m.account?.name ?? null });
      if (page >= res.pagination.totalPage) break;
      page++;
    }
    return NextResponse.json({ count: mappings.length, mappings }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur VRPlatform inconnue." },
      { status: 502 }
    );
  }
}
