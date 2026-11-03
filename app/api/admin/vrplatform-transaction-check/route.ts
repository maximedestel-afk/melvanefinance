import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { isVrPlatformConfigured } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// TEMPORAIRE — diagnostic pour voir si VRPlatform expose les "transactions"
// (le paiement bancaire réel, parent des lignes /reports/journal-entries)
// comme ressource à part, et sous quelle forme (GET /transactions/{id},
// GET /transactions?...). L'utilisateur veut rapprocher une facture avec le
// PAIEMENT BANCAIRE, pas avec les lignes comptables par compte — on a déjà
// vu "entityType":"transaction" et un "transactionId" sur chaque ligne
// (voir /api/admin/journal-entry-fields-check), donc l'objet transaction
// existe forcément quelque part côté VRPlatform.
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

  const transactionId = new URL(request.url).searchParams.get("transactionId") ?? "39848b77-cb88-4985-b8b2-078318a7bf25";

  const attempts: Record<string, unknown> = {};
  const candidates: [string, string, Record<string, string>?][] = [
    ["get_transaction_by_id", `/transactions/${transactionId}`],
    ["list_transactions", "/transactions", { limit: "5" }],
    ["list_transactions_expense_type", "/transactions", { limit: "5", type: "expense" }],
    ["list_payments", "/payments", { limit: "5" }],
    ["list_bills", "/bills", { limit: "5" }],
    ["list_bank_transactions", "/bank-transactions", { limit: "5" }],
  ];

  for (const [key, path, query] of candidates) {
    try {
      attempts[key] = await vrPlatformFetchRaw(path, query);
    } catch (err) {
      attempts[key] = { error: err instanceof Error ? err.message : "Erreur inconnue." };
    }
  }

  return NextResponse.json({ transactionId, attempts }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
