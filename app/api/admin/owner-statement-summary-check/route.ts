import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { isVrPlatformConfigured } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// TEMPORAIRE — diagnostic pour voir la forme brute de
// /reports/owner-statement-summaries-per-layout (et sa variante /details/
// {contactId}?view=listing), notamment le champ "financials" (netRevenue
// par bien) — pour construire la colonne "Owner Revenue" de l'onglet Due to
// owner à partir du Net Revenue du relevé plutôt que d'un calcul maison.
// Voir app/DueToOwnerTable.tsx.
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

  const searchParams = new URL(request.url).searchParams;
  const dateRange = searchParams.get("dateRange") ?? String(new Date().getUTCFullYear());
  const search = searchParams.get("search");

  try {
    const summaries = (await vrPlatformFetchRaw("/reports/owner-statement-summaries-per-layout", {
      dateRange,
      ...(search ? { search } : {}),
    })) as { data: { contact: { id: string; name: string | null; email: string | null } }[] };

    const firstContactId = summaries.data[0]?.contact?.id;
    const details = firstContactId
      ? await vrPlatformFetchRaw(`/reports/owner-statement-summaries-per-layout/details/${firstContactId}`, {
          dateRange,
          view: "listing",
        })
      : null;

    return NextResponse.json(
      { dateRange, search, summaries, firstContactId, details },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur inconnue." }, { status: 502 });
  }
}
