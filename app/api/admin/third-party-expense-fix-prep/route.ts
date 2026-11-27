import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { isVrPlatformConfigured } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// TEMPORAIRE — préparation (lecture seule) avant de corriger dans VRPlatform
// les dépenses payées par un tiers (Carte 5G, FREE...) actuellement
// enregistrées à tort en Paid/Non-Trust/Expense Reimbursement Revenue. On
// veut les repasser en Contact = prop@melvane.com, Status = Unpaid. Cette
// route : (1) trouve le contactId de prop@melvane.com, (2) liste tous les
// transactionId concernés (Carte 5G + FREE) avec leur état actuel complet
// via GET /transactions/{id}, pour valider le plan avant toute écriture.
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
  description: string | null;
  transactionId: string | null;
}
interface VrJournalEntriesResponse {
  data: VrJournalEntry[];
  pagination: { page: number; totalPage: number };
}

interface VrContact {
  id: string;
  name: string | null;
  email: string | null;
}
interface VrContactsResponse {
  data: VrContact[];
  pagination: { page: number; totalPage: number };
}

interface VrTransaction {
  id: string;
  description: string | null;
  status: string;
  type: string;
  contact?: { id: string; name: string | null; email: string | null } | null;
  payment?: { status: string } | null;
  account?: { id: string; name: string } | null;
}

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });
  if (!isVrPlatformConfigured()) {
    return NextResponse.json({ error: "VRPlatform n'est pas configuré sur ce déploiement." }, { status: 500 });
  }

  // 1. Contact prop@melvane.com
  let propContact: VrContact | null = null;
  try {
    const res = (await vrPlatformFetchRaw(
      `/contacts?search=${encodeURIComponent("prop@melvane.com")}&limit=50&page=1`
    )) as VrContactsResponse;
    propContact = res.data.find((c) => (c.email ?? "").toLowerCase() === "prop@melvane.com") ?? res.data[0] ?? null;
  } catch (err) {
    return NextResponse.json({ error: `Recherche contact échouée: ${err instanceof Error ? err.message : err}` }, { status: 502 });
  }

  // 2. Transactions concernées (Carte 5G + FREE)
  const transactionIds = new Set<string>();
  for (const term of ["Carte 5G", "FREE"]) {
    try {
      const res = (await vrPlatformFetchRaw(
        `/reports/journal-entries?search=${encodeURIComponent(term)}&limit=250&page=1`
      )) as VrJournalEntriesResponse;
      for (const e of res.data) if (e.transactionId) transactionIds.add(e.transactionId);
    } catch {
      // ignore, le détail apparaîtra manquant dans le résultat
    }
  }

  // 3. État actuel de chaque transaction
  const transactions: (VrTransaction | { id: string; error: string })[] = [];
  for (const id of transactionIds) {
    try {
      const tx = (await vrPlatformFetchRaw(`/transactions/${id}`)) as VrTransaction;
      transactions.push(tx);
    } catch (err) {
      transactions.push({ id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json(
    {
      propContact,
      transactionCount: transactionIds.size,
      transactions: transactions.map((t) =>
        "error" in t
          ? t
          : {
              id: t.id,
              description: t.description,
              type: t.type,
              status: t.status,
              paymentStatus: t.payment?.status ?? null,
              contactEmail: t.contact?.email ?? null,
              contactName: t.contact?.name ?? null,
              accountName: t.account?.name ?? null,
            }
      ),
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
