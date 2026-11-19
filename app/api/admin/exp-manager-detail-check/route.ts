import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { isVrPlatformConfigured, listVrPlatformListings } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// TEMPORAIRE — diagnostic pour voir le détail des écritures qui composent
// Exp Manager d'un bien sur un mois donné (reference, year, month) — mêmes
// comptes que addListingExpManager (EXPENSE_ACCOUNT_IDS hors Housekeeping,
// Transfer Fees et Payout Adjustments — ces deux derniers sont des frais que
// le propriétaire paie AU manager, donc un profit pour le manager, pas une
// dépense qu'il engage pour le bien), pour comprendre un montant affiché
// dans l'onglet Revenus.
const API_BASE_URL = "https://api.vrplatform.app";

const EXPENSE_ACCOUNT_IDS_NO_HOUSEKEEPING = [
  "562002c2-4ee2-49ab-98ad-78760e928a76", // Maintenance
  "3daed64f-aad5-4286-b38d-b11eebe2bf18", // Supplies
  "9a650331-1cc2-40e0-a6e9-462ee6c70d5d", // Insurance
  "988fd364-33c5-4c4a-896e-80a42e7a768e", // Delivery
  "7dfff8bb-3be8-4498-8ba5-8d2798c91815", // Waiting Time
  "7c08b758-4760-4300-aa1f-8af38f7f8b4f", // Expense Reimbursement Revenue
  "26c88bed-c6e3-4fd6-a422-2cea05ec784c", // Expense Reimbursement Revenue - Supplies
  "9927d0a7-fb96-48bb-a585-9359b2b6e36e", // Expense Reimbursement Revenue - Maintenance
  "dea04c5a-824f-4dc6-80f9-eee706a7de3a", // Expense Markup Revenue
  "6486ff97-60a2-4bed-93c8-eae682a5939e", // Co-Host Payouts
  "891ffc56-15ee-4ac7-9ace-b670e31361dd", // Guest Refund
  "a9c0d5aa-0f0d-492d-a49a-2d86972baa63", // VRBO comm share Expenses
  "b14d1581-0ca4-4a5d-8a61-d8161c15f38a", // VRBO comm share Revenues
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
  const reference = searchParams.get("reference");
  const year = searchParams.get("year");
  const month = searchParams.get("month");
  if (!reference || !year || !month) {
    return NextResponse.json({ error: "Paramètres 'reference', 'year' et 'month' requis." }, { status: 400 });
  }
  const monthPadded = month.padStart(2, "0");
  const dateFilter = `${year}-${monthPadded}`;

  try {
    const listings = await listVrPlatformListings();
    const listing = listings.find((l) => l.name.trim().toLowerCase() === reference.trim().toLowerCase());
    if (!listing) {
      return NextResponse.json({ error: `Aucun listing VRPlatform actif ne correspond à "${reference}".` }, { status: 404 });
    }

    const entries = (await vrPlatformFetchRaw("/reports/journal-entries", {
      accountIds: EXPENSE_ACCOUNT_IDS_NO_HOUSEKEEPING.join(","),
      listingIds: listing.id,
      date: dateFilter,
      status: "active",
      limit: "250",
    })) as { data: unknown[] };

    return NextResponse.json(
      { reference, listingId: listing.id, dateFilter, entries },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur inconnue." }, { status: 502 });
  }
}
