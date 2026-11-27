import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { isVrPlatformConfigured } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";

// TEMPORAIRE — l'utilisateur voit ses dépenses internet (Carte 5G) payées
// par un compte non-trust remonter en POSITIF dans la colonne Dépenses de
// l'onglet Revenus, alors qu'elles devraient être négatives (un coût). On
// cherche toutes les écritures liées à "Carte 5G" / "FREE" (tous comptes,
// pas seulement Expense Reimbursement Revenue) pour voir le signe exact de
// la ligne qui tombe dans MANAGER_EXPENSE_ACCOUNT_IDS (lib/vrplatform.ts) —
// la logique actuelle fait `managerExpenseCents -= entry.centTotal`, ce qui
// suppose un centTotal positif pour un coût (comme "Apporteur Affaire").
const API_BASE_URL = "https://api.vrplatform.app";

async function vrPlatformFetchRaw(path: string): Promise<unknown> {
  const apiKey = process.env.VRPLATFORM_API_KEY;
  const teamId = process.env.VRPLATFORM_TEAM_ID;
  if (!apiKey || !teamId) throw new Error("VRPlatform n'est pas configuré.");
  const url = new URL(path, API_BASE_URL);
  const response = await fetch(url, { headers: { "x-api-key": apiKey, "x-team-id": teamId }, cache: "no-store" });
  const text = await response.text();
  if (!response.ok) throw new Error(`VRPlatform ${response.status}: ${text}`);
  return JSON.parse(text);
}

interface VrJournalEntry {
  [key: string]: unknown;
  id: string;
  txnAt: string;
  description: string | null;
  centTotal: number;
  party: string | null;
  status: string;
  account?: { id: string; name: string } | null;
}
interface VrJournalEntriesResponse {
  data: VrJournalEntry[];
  pagination: { page: number; totalPage: number };
}

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });
  if (!isVrPlatformConfigured()) {
    return NextResponse.json({ error: "VRPlatform n'est pas configuré sur ce déploiement." }, { status: 500 });
  }

  const results: Record<string, unknown[]> = {};
  for (const term of ["Carte 5G", "FREE"]) {
    try {
      const res = (await vrPlatformFetchRaw(
        `/reports/journal-entries?search=${encodeURIComponent(term)}&limit=100&page=1`
      )) as VrJournalEntriesResponse;
      results[term] = res.data.map((e) => ({
        txnAt: e.txnAt,
        description: e.description,
        party: e.party,
        centTotal: e.centTotal,
        accountName: e.account?.name ?? null,
      }));
    } catch (err) {
      results[term] = [{ error: err instanceof Error ? err.message : String(err) }];
    }
  }

  return NextResponse.json(results, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
