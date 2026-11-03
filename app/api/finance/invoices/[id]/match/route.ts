import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { findBankRecordsByAmount, isVrPlatformConfigured } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Cherche, dans les enregistrements bancaires VRPlatform (ressource
 * /bank-records — le relevé bancaire réel, pas les écritures comptables
 * individuelles de /transactions), ceux dont le montant correspond
 * exactement au montant de la facture — uniquement sur le montant, sans
 * filtrer par fournisseur. */
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
    const matches = await findBankRecordsByAmount(invoice.amount_cents);
    return NextResponse.json(
      { invoiceAmountCents: invoice.amount_cents, supplierName: invoice.supplier_name, matches },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur VRPlatform inconnue." },
      { status: 502 }
    );
  }
}
