import { NextResponse } from "next/server";
import { getCurrentProfile, listPropertiesForFinance } from "@/lib/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortfolioExpenseEntriesByVendor, isVrPlatformConfigured } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Tolérance pour considérer deux montants comme égaux (arrondis éventuels).
const MATCH_TOLERANCE_CENTS = 1;

/** Cherche, parmi TOUTES les écritures de dépense VRPlatform (comptes
 * EXPENSE_ACCOUNT_IDS, tout le portefeuille, sans filtrer par fournisseur —
 * le texte de la description ne contient pas toujours fidèlement son nom),
 * LE PAIEMENT (regroupement par transactionId — une même transaction
 * VRPlatform peut avoir plusieurs lignes, ex: une intervention facturée sur
 * plusieurs réservations/biens à la fois) dont le total correspond
 * exactement au montant payé. Si aucun paiement exact n'est trouvé, renvoie
 * en secours les lignes dont la description contient le nom du fournisseur,
 * pour vérification manuelle. */
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
    .select("supplier_name, amount_cents, invoice_date")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!invoice) return NextResponse.json({ error: "Facture introuvable." }, { status: 404 });

  const year = invoice.invoice_date ? Number(invoice.invoice_date.slice(0, 4)) : new Date().getUTCFullYear();
  const allMonths = Array.from({ length: 12 }, (_, i) => i + 1);

  try {
    const allProperties = await listPropertiesForFinance();

    const entries = await getPortfolioExpenseEntriesByVendor(
      allProperties.map((p) => ({
        propertyId: p.id,
        reference: p.reference,
        name: p.name,
        rentType: p.rentType,
        rentAmount: p.rentAmount,
        commissionPercent: p.commissionPercent,
        extraVrplatformReferences: p.extraVrplatformReferences,
      })),
      year,
      allMonths
      // Pas de filtre fournisseur ici — on cherche par montant de paiement,
      // pas par texte de description (voir commentaire plus haut).
    );

    // Regroupe par paiement VRPlatform (transactionId) — une ligne sans
    // transactionId reste un paiement à elle seule.
    const groups = new Map<string, typeof entries>();
    entries.forEach((entry, i) => {
      const key = entry.transactionId ?? `__solo-${i}`;
      const group = groups.get(key);
      if (group) group.push(entry);
      else groups.set(key, [entry]);
    });

    let matchedLines: typeof entries = [];
    let matchedTotalCents = 0;
    let found = false;
    for (const group of groups.values()) {
      const total = group.reduce((sum, e) => sum + e.cents, 0);
      if (Math.abs(total - invoice.amount_cents) <= MATCH_TOLERANCE_CENTS) {
        matchedLines = group;
        matchedTotalCents = total;
        found = true;
        break;
      }
    }

    const needle = invoice.supplier_name.trim().toLowerCase();
    const vendorFilteredEntries = found ? [] : entries.filter((e) => (e.description ?? "").toLowerCase().includes(needle));

    return NextResponse.json(
      {
        invoiceAmountCents: invoice.amount_cents,
        found,
        matchedTotalCents,
        matchedLines,
        allEntries: vendorFilteredEntries,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur VRPlatform inconnue." },
      { status: 502 }
    );
  }
}
