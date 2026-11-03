import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { isVrPlatformConfigured } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// TEMPORAIRE — diagnostic pour voir TOUS les champs bruts renvoyés par
// /reports/journal-entries (pas seulement txnAt/centTotal/party/description/
// account/reservationId qu'on type aujourd'hui dans lib/vrplatform.ts). On
// cherche un champ de regroupement "bill"/"payment" qui relierait plusieurs
// lignes à un même paiement fournisseur — pour rapprocher une facture par
// MONTANT DE PAIEMENT plutôt que par simple somme de toutes les lignes
// correspondant au nom du fournisseur.
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
  const vendor = (searchParams.get("vendor") ?? "").toLowerCase();
  const year = searchParams.get("year") ?? String(new Date().getUTCFullYear());

  try {
    const matches: Record<string, unknown>[] = [];
    let page = 1;
    for (;;) {
      const res = (await vrPlatformFetchRaw("/reports/journal-entries", {
        accountIds: EXPENSE_ACCOUNT_IDS.join(","),
        date: year,
        status: "active",
        limit: "250",
        page: String(page),
      })) as { data: Record<string, unknown>[]; pagination: { page: number; totalPage: number } };
      for (const entry of res.data) {
        const description = typeof entry.description === "string" ? entry.description.toLowerCase() : "";
        if (vendor === "" || description.includes(vendor)) matches.push(entry);
      }
      if (page >= res.pagination.totalPage || matches.length >= 40) break;
      page++;
    }

    return NextResponse.json(
      { year, vendor, count: matches.length, allFieldNames: matches.length > 0 ? Object.keys(matches[0]) : [], entries: matches.slice(0, 40) },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur VRPlatform inconnue." },
      { status: 502 }
    );
  }
}
