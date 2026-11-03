import { NextResponse } from "next/server";
import { getCurrentProfile, listPropertiesForFinance } from "@/lib/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortfolioExpenseEntriesByVendor, isVrPlatformConfigured } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Cherche, dans les écritures de dépense VRPlatform (comptes
 * EXPENSE_ACCOUNT_IDS — Housekeeping, Maintenance, Supplies...), les lignes
 * dont la description contient le nom du fournisseur de cette facture —
 * même mécanique que /api/admin/vendor-expenses, mais ciblée sur UNE
 * facture : son bien si renseigné, sinon tout le portefeuille, sur l'année
 * de la facture (les écritures peuvent être postées un peu après la date
 * de facture). */
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
    .select("supplier_name, amount_cents, invoice_date, property_id")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!invoice) return NextResponse.json({ error: "Facture introuvable." }, { status: 404 });

  const year = invoice.invoice_date ? Number(invoice.invoice_date.slice(0, 4)) : new Date().getUTCFullYear();
  const allMonths = Array.from({ length: 12 }, (_, i) => i + 1);

  try {
    const allProperties = await listPropertiesForFinance();
    const properties = invoice.property_id ? allProperties.filter((p) => p.id === invoice.property_id) : allProperties;

    const matches = await getPortfolioExpenseEntriesByVendor(
      properties.map((p) => ({
        propertyId: p.id,
        reference: p.reference,
        name: p.name,
        rentType: p.rentType,
        rentAmount: p.rentAmount,
        commissionPercent: p.commissionPercent,
        extraVrplatformReferences: p.extraVrplatformReferences,
      })),
      year,
      allMonths,
      invoice.supplier_name
    );

    return NextResponse.json(
      { invoiceAmountCents: invoice.amount_cents, matches },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur VRPlatform inconnue." },
      { status: 502 }
    );
  }
}
