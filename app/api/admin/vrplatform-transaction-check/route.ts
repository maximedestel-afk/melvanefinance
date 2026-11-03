import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { isVrPlatformConfigured } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// TEMPORAIRE — diagnostic : récupère l'OpenAPI spec publique de VRPlatform
// (eu.api.vrplatform.app/openapi.json) pour arrêter de deviner les
// paramètres de /transactions, /contacts, /payments par essais-erreurs.
// Prend ?invoiceNumber=... (ou ?amountCents=... directement) pour aussi
// relire le montant exact stocké en base pour une facture donnée.
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

  // Récupère l'OpenAPI spec publique pour arrêter de deviner les paramètres
  // par essais-erreurs — répond d'un coup à toutes les questions en cours
  // (recherche de contact par nom/email, pagination /transactions...).
  let openapiPathsSummary: unknown = null;
  try {
    const specRes = await fetch("https://eu.api.vrplatform.app/openapi.json", { cache: "no-store" });
    const spec = await specRes.json();
    const paths = spec?.paths ?? {};
    const relevant = Object.keys(paths).filter((p: string) => /transaction|contact|payment|bill/i.test(p));
    openapiPathsSummary = Object.fromEntries(
      relevant.map((p) => [
        p,
        Object.fromEntries(
          Object.entries(paths[p]).map(([method, def]: [string, unknown]) => [
            method,
            {
              parameters: (def as { parameters?: { name: string; in: string; required?: boolean }[] })?.parameters?.map(
                (param) => ({ name: param.name, in: param.in, required: param.required })
              ),
            },
          ])
        ),
      ])
    );
  } catch (err) {
    openapiPathsSummary = { error: err instanceof Error ? err.message : "Erreur inconnue." };
  }

  return NextResponse.json(
    { invoiceRow, amountCents, openapiPathsSummary },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
