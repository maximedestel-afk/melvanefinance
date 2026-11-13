import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { isVrPlatformConfigured } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// TEMPORAIRE — diagnostic pour voir les champs bruts de /reports/journal-entries
// (filtré par contactIds) et de /transactions (filtré par contactId), pour
// comprendre pourquoi "listing" n'apparaît pas sur les lignes de l'onglet
// Supplier. Voir app/SupplierExpensesTable.tsx et getVendorExpenses dans
// lib/vrplatform.ts.
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
  const contactId = searchParams.get("contactId");
  const dateRange = searchParams.get("dateRange") ?? String(new Date().getUTCFullYear());
  if (!contactId) return NextResponse.json({ error: "Paramètre 'contactId' requis." }, { status: 400 });

  try {
    const transactions = (await vrPlatformFetchRaw("/transactions", {
      type: "expense",
      contactId,
      dateRange,
      limit: "10",
      sort: "-date",
    })) as { data: { id: string }[] };

    const transactionIds = transactions.data.map((t) => t.id);

    const journalEntriesAllTypes = transactionIds.length
      ? await vrPlatformFetchRaw("/reports/journal-entries", {
          transactionIds: transactionIds.join(","),
          limit: "50",
        })
      : null;

    const journalEntriesLineType = transactionIds.length
      ? await vrPlatformFetchRaw("/reports/journal-entries", {
          transactionIds: transactionIds.join(","),
          types: "transaction_expense_line",
          limit: "50",
        })
      : null;

    return NextResponse.json(
      { transactions, journalEntriesAllTypes, journalEntriesLineType },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur inconnue." }, { status: 502 });
  }
}
