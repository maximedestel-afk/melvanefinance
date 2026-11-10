import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { isVrPlatformConfigured } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// TEMPORAIRE — le champ exact par lequel /reports/journal-entries indique le
// listing rattaché à une écriture (s'il y en a un) n'a jamais été vérifié en
// direct (sandbox sans accès réseau VRPlatform). Ce diagnostic renvoie des
// écritures manager brutes (party=manager) sur les comptes de dépense réels
// (EXPENSE_ACCOUNT_IDS ∪ category.classification="expense", même logique que
// la lib) pour repérer le bon champ (listing, listingId...) et fiabiliser la
// colonne "Bien" de l'onglet Dépenses.
const API_BASE_URL = "https://api.vrplatform.app";

const EXPENSE_ACCOUNT_IDS = [
  "562002c2-4ee2-49ab-98ad-78760e928a76",
  "4c2860e2-0acc-4b22-b665-38005b8cd610",
  "3daed64f-aad5-4286-b38d-b11eebe2bf18",
  "9a650331-1cc2-40e0-a6e9-462ee6c70d5d",
  "988fd364-33c5-4c4a-896e-80a42e7a768e",
  "7dfff8bb-3be8-4498-8ba5-8d2798c91815",
  "7c08b758-4760-4300-aa1f-8af38f7f8b4f",
  "26c88bed-c6e3-4fd6-a422-2cea05ec784c",
  "9927d0a7-fb96-48bb-a585-9359b2b6e36e",
  "dea04c5a-824f-4dc6-80f9-eee706a7de3a",
  "8aa7d442-e286-43ce-a8db-161c3cf4ae7a",
  "e2f66f13-dc2a-4f0c-a536-29fa20427fff",
  "6486ff97-60a2-4bed-93c8-eae682a5939e",
  "891ffc56-15ee-4ac7-9ace-b670e31361dd",
  "a9c0d5aa-0f0d-492d-a49a-2d86972baa63",
  "b14d1581-0ca4-4a5d-8a61-d8161c15f38a",
  "eaedcd1b-99d7-4532-96eb-d2144dc7b9ca",
  "53bfbbf0-7432-4521-a275-86abee55b5b3",
];

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

  const fetchJson = async (path: string, params: Record<string, string>) => {
    const url = new URL(path, API_BASE_URL);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url, { headers: { "x-api-key": apiKey, "x-team-id": teamId }, cache: "no-store" });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  const accountIds = new Set<string>(EXPENSE_ACCOUNT_IDS);
  {
    let page = 1;
    for (;;) {
      const { body } = await fetchJson("/accounts", { status: "active", limit: "250", page: String(page) });
      for (const a of body?.data ?? []) {
        if (a.category?.classification === "expense") accountIds.add(a.id);
      }
      if (page >= (body?.pagination?.totalPage ?? 1)) break;
      page++;
    }
  }

  const accountIdsList = Array.from(accountIds);
  const chunks: string[][] = [];
  for (let i = 0; i < accountIdsList.length; i += 25) chunks.push(accountIdsList.slice(i, i + 25));

  const allEntries: Record<string, unknown>[] = [];
  for (const chunk of chunks) {
    let page = 1;
    for (;;) {
      const { body } = await fetchJson("/reports/journal-entries", {
        accountIds: chunk.join(","),
        date: year,
        status: "active",
        limit: "250",
        page: String(page),
      });
      for (const e of body?.data ?? []) allEntries.push(e);
      if (page >= (body?.pagination?.totalPage ?? 1)) break;
      page++;
    }
  }

  const managerEntries = allEntries.filter((e) => e.party === "manager" && typeof e.centTotal === "number" && e.centTotal > 0);
  const firstEntryFieldNames = allEntries[0] ? Object.keys(allEntries[0]) : [];

  return NextResponse.json(
    {
      accountIdsChecked: accountIdsList.length,
      totalEntries: allEntries.length,
      managerPositiveEntriesCount: managerEntries.length,
      firstEntryFieldNames,
      sampleManagerEntries: managerEntries.slice(0, 15),
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
