import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { isVrPlatformConfigured } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// TEMPORAIRE — diagnostic pour comprendre pourquoi findExpenseTransactionsByAmount
// (lib/vrplatform.ts) ne retrouve pas un paiement dont l'utilisateur confirme
// l'existence côté VRPlatform. Prend ?invoiceNumber=... (ou ?amountCents=...
// directement), relit le montant exact stocké en base pour cette facture, et
// teste plusieurs variantes de requête /transactions (signe, avec/sans type,
// recherche élargie ±1€) pour voir laquelle retrouve le bon paiement.
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

  const searchParams = new URL(request.url).searchParams;
  const invoiceNumber = searchParams.get("invoiceNumber");
  let amountCents = searchParams.get("amountCents") ? Number.parseInt(searchParams.get("amountCents") as string, 10) : null;
  let invoiceRow: Record<string, unknown> | null = null;

  if (invoiceNumber) {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("supplier_invoices")
      .select("id, supplier_name, amount_cents, invoice_date, invoice_number")
      .eq("invoice_number", invoiceNumber)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: `Aucune facture avec invoice_number="${invoiceNumber}".` }, { status: 404 });
    invoiceRow = data;
    amountCents = data.amount_cents;
  }

  if (amountCents == null) {
    return NextResponse.json({ error: "Paramètre 'invoiceNumber' ou 'amountCents' requis." }, { status: 400 });
  }

  const sweepItContactId = "7e1bb3b4-788d-4aef-90b3-897ca74952cc";
  const attempts: Record<string, unknown> = {};
  const candidates: [string, string, Record<string, string>?][] = [
    ["amount_negative_no_type", "/transactions", { limit: "10", amount: String(-amountCents) }],
    ["amount_positive_no_type", "/transactions", { limit: "10", amount: String(amountCents) }],
    ["amount_negative_type_expense", "/transactions", { limit: "10", type: "expense", amount: String(-amountCents) }],
    ["amount_negative_type_payout", "/transactions", { limit: "10", type: "payout", amount: String(-amountCents) }],
    ["by_contactId", "/transactions", { limit: "20", contactId: sweepItContactId }],
    ["by_contact_id_snake", "/transactions", { limit: "20", contact_id: sweepItContactId }],
  ];

  for (const [key, path, query] of candidates) {
    try {
      attempts[key] = await vrPlatformFetchRaw(path, query);
    } catch (err) {
      attempts[key] = { error: err instanceof Error ? err.message : "Erreur inconnue." };
    }
  }

  return NextResponse.json(
    { invoiceRow, amountCents, attempts },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
