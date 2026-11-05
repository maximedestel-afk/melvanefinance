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
    .select("property_id, owner_name, iban, account_name");
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({
    details: (data ?? []).map((row) => ({
      propertyId: row.property_id,
      ownerName: row.owner_name,
      iban: row.iban,
      accountName: row.account_name,
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
  const ownerName = typeof body.ownerName === "string" ? body.ownerName.trim() : "";
  // L'IBAN ne doit jamais contenir d'espaces (copier-coller depuis un RIB en
  // contient presque toujours) — on les retire systématiquement ici, en plus
  // de l'onChange côté client, pour ne jamais en stocker.
  const iban = typeof body.iban === "string" ? body.iban.replace(/\s+/g, "").toUpperCase() : "";
  const accountName = typeof body.accountName === "string" ? body.accountName.trim() : "";

  const supabase = createAdminClient();
  const { error: dbError } = await supabase.from("property_bank_details").upsert(
    {
      property_id: propertyId,
      owner_name: ownerName || null,
      iban: iban || null,
      account_name: accountName || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "property_id" }
  );
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
