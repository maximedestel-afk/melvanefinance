import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { isVrPlatformConfigured } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// TEMPORAIRE — le champ exact par lequel /reports/journal-entries indique le
// listing rattaché à une écriture (s'il y en a un) n'a jamais été vérifié en
// direct (sandbox sans accès réseau VRPlatform). Ce diagnostic renvoie
// quelques écritures manager brutes (party=manager) pour repérer le bon
// champ (listing, listingId, property...) et fiabiliser la colonne "Bien"
// de l'onglet Dépenses.
const API_BASE_URL = "https://api.vrplatform.app";

export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });
  if (!isVrPlatformConfigured()) {
    return NextResponse.json({ error: "VRPlatform n'est pas configuré sur ce déploiement." }, { status: 500 });
  }

  const apiKey = process.env.VRPLATFORM_API_KEY!;
  const teamId = process.env.VRPLATFORM_TEAM_ID!;
  const searchParams = new URL(request.url).searchParams;
  const year = searchParams.get("year") ?? String(new Date().getFullYear());

  // Un seul lot de 25 comptes (même taille que ACCOUNT_ID_CHUNK_SIZE côté
  // lib/vrplatform.ts) pour rester rapide — ni EXPENSE_ACCOUNT_IDS ni
  // classification="expense" (qui exclut Housekeeping) ne couvrent
  // fiablement tous les comptes, et une liste de TOUS les IDs de comptes
  // dans l'URL dépasserait la longueur d'URL maximale.
  const accountsUrl = new URL("/accounts", API_BASE_URL);
  accountsUrl.searchParams.set("status", "active");
  accountsUrl.searchParams.set("limit", "25");
  accountsUrl.searchParams.set("page", "1");
  const accountsRes = await fetch(accountsUrl, { headers: { "x-api-key": apiKey, "x-team-id": teamId }, cache: "no-store" });
  const accountsBody = await accountsRes.json().catch(() => null);
  const accountIds: string[] = (accountsBody?.data ?? []).map((a: { id: string }) => a.id);

  const url = new URL("/reports/journal-entries", API_BASE_URL);
  url.searchParams.set("accountIds", accountIds.join(","));
  url.searchParams.set("date", year);
  url.searchParams.set("status", "active");
  url.searchParams.set("limit", "250");
  url.searchParams.set("page", "1");
  const response = await fetch(url, { headers: { "x-api-key": apiKey, "x-team-id": teamId }, cache: "no-store" });
  const body = await response.json().catch(() => null);

  const allEntries: Record<string, unknown>[] = Array.isArray(body?.data) ? body.data : [];
  const managerEntries = allEntries.filter((e) => e.party === "manager");
  const firstEntryFieldNames = allEntries[0] ? Object.keys(allEntries[0]) : [];

  return NextResponse.json(
    {
      accountsChecked: accountIds.length,
      status: response.status,
      totalEntries: allEntries.length,
      managerEntriesCount: managerEntries.length,
      firstEntryFieldNames,
      sampleManagerEntries: managerEntries.slice(0, 10),
      sampleAnyEntries: allEntries.slice(0, 5),
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
