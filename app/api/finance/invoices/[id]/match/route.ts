import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { isVrPlatformConfigured, reconcileInvoiceWithVrPlatform } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Rapproche une facture avec les vraies transactions bancaires VRPlatform
 * (ressource /transactions, pas les lignes comptables de
 * /reports/journal-entries) : trouve le contact fournisseur
 * (/contacts?search=...), puis cherche parmi ses transactions celle au
 * montant exact. Sans correspondance exacte, renvoie les transactions de ce
 * fournisseur les plus proches en montant pour vérification manuelle. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });
  if (!isVrPlatformConfigured()) {
    return NextResponse.json({ error: "VRPlatform n'est pas configuré sur ce déploiement." }, { status: 500 });
  }
  const { id } = await params;

  const supabase = createAdminClient();
  const { data: invoice, error: fetchError } = await supabase
    .from("supplier_invoices")
    .select("supplier_name, amount_cents")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!invoice) return NextResponse.json({ error: "Facture introuvable." }, { status: 404 });

  try {
    const result = await reconcileInvoiceWithVrPlatform(invoice.supplier_name, invoice.amount_cents);
    return NextResponse.json(
      { invoiceAmountCents: invoice.amount_cents, supplierName: invoice.supplier_name, ...result },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur VRPlatform inconnue." },
      { status: 502 }
    );
  }
}
