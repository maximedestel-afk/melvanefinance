import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const profile = await getCurrentProfile();
  if (!profile) return { error: NextResponse.json({ error: "Non authentifié." }, { status: 401 }) };
  if (profile.role !== "admin") return { error: NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 }) };
  return { error: null };
}

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const supabase = createAdminClient();
  let { data, error: dbError } = await supabase
    .from("property_bank_details")
    .select("property_id, iban, account_name, account_reference, auto_payment_setup");
  // Si une colonne récente (ex: auto_payment_setup) n'existe pas encore côté
  // Supabase (migration pas encore appliquée), on retombe sur les colonnes de
  // base plutôt que de faire échouer tout le chargement du tableau.
  if (dbError) {
    const fallback = await supabase.from("property_bank_details").select("property_id, iban, account_name, account_reference");
    if (fallback.error) return NextResponse.json({ error: fallback.error.message }, { status: 500 });
    data = fallback.data.map((row) => ({ ...row, auto_payment_setup: false }));
    dbError = null;
  }

  return NextResponse.json({
    details: (data ?? []).map((row) => ({
      propertyId: row.property_id,
      iban: row.iban,
      accountName: row.account_name,
      accountReference: row.account_reference,
      autoPaymentSetup: row.auto_payment_setup ?? false,
    })),
  });
}

export async function PUT(request: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  const body = await request.json();
  const propertyId = typeof body.propertyId === "string" ? body.propertyId : null;
  if (!propertyId) {
    return NextResponse.json({ error: "propertyId invalide." }, { status: 400 });
  }
  // L'IBAN ne doit jamais contenir d'espaces (copier-coller depuis un RIB en
  // contient presque toujours) — on les retire systématiquement ici, en plus
  // de l'onChange côté client, pour ne jamais en stocker.
  const iban = typeof body.iban === "string" ? body.iban.replace(/\s+/g, "").toUpperCase() : "";
  const accountName = typeof body.accountName === "string" ? body.accountName.trim() : "";
  const accountReference = typeof body.accountReference === "string" ? body.accountReference.trim() : "";
  const autoPaymentSetup = body.autoPaymentSetup === true;

  const supabase = createAdminClient();
  const basePayload = {
    property_id: propertyId,
    iban: iban || null,
    account_name: accountName || null,
    account_reference: accountReference || null,
    updated_at: new Date().toISOString(),
  };
  const { error: dbError } = await supabase
    .from("property_bank_details")
    .upsert({ ...basePayload, auto_payment_setup: autoPaymentSetup }, { onConflict: "property_id" });
  if (dbError) {
    // Ne jamais perdre l'IBAN/nom/référence déjà saisis si une colonne plus
    // récente (ex: auto_payment_setup) n'existe pas encore côté Supabase —
    // on retente sans elle plutôt que de faire échouer tout l'enregistrement.
    const retry = await supabase.from("property_bank_details").upsert(basePayload, { onConflict: "property_id" });
    if (retry.error) return NextResponse.json({ error: retry.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
