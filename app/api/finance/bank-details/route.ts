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
  const { data, error: dbError } = await supabase
    .from("property_bank_details")
    .select("property_id, owner_last_name, owner_first_name, iban, account_name, account_reference");
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({
    details: (data ?? []).map((row) => ({
      propertyId: row.property_id,
      ownerLastName: row.owner_last_name,
      ownerFirstName: row.owner_first_name,
      iban: row.iban,
      accountName: row.account_name,
      accountReference: row.account_reference,
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
  const ownerLastName = typeof body.ownerLastName === "string" ? body.ownerLastName.trim() : "";
  const ownerFirstName = typeof body.ownerFirstName === "string" ? body.ownerFirstName.trim() : "";
  // L'IBAN ne doit jamais contenir d'espaces (copier-coller depuis un RIB en
  // contient presque toujours) — on les retire systématiquement ici, en plus
  // de l'onChange côté client, pour ne jamais en stocker.
  const iban = typeof body.iban === "string" ? body.iban.replace(/\s+/g, "").toUpperCase() : "";
  const accountName = typeof body.accountName === "string" ? body.accountName.trim() : "";
  const accountReference = typeof body.accountReference === "string" ? body.accountReference.trim() : "";
  // Nom du propriétaire composé automatiquement "Nom Prénom" à partir des
  // deux champs saisis séparément, conservé en plus pour un affichage ou une
  // recherche simple ailleurs (CSV, etc.) sans avoir à recomposer à chaque fois.
  const ownerName = [ownerLastName, ownerFirstName].filter(Boolean).join(" ");

  const supabase = createAdminClient();
  const { error: dbError } = await supabase.from("property_bank_details").upsert(
    {
      property_id: propertyId,
      owner_last_name: ownerLastName || null,
      owner_first_name: ownerFirstName || null,
      owner_name: ownerName || null,
      iban: iban || null,
      account_name: accountName || null,
      account_reference: accountReference || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "property_id" }
  );
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
