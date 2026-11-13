import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// TEMPORAIRE — diagnostic pour voir pourquoi un bien donné n'a pas de
// commission affichée dans l'onglet Revenus (commissionCents reste null si
// property_owner.commission_percent est vide OU si rent_type = "fixe", voir
// lib/queries.ts et app/PropertyFinanceTable.tsx).
export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  const reference = new URL(request.url).searchParams.get("reference");
  if (!reference) return NextResponse.json({ error: "Paramètre 'reference' requis." }, { status: 400 });

  const supabase = createAdminClient();
  const { data: property, error: propertyError } = await supabase
    .from("properties")
    .select("id, reference, name, tags")
    .ilike("reference", reference)
    .maybeSingle();
  if (propertyError) return NextResponse.json({ error: propertyError.message }, { status: 500 });
  if (!property) return NextResponse.json({ error: `Aucun bien avec la référence "${reference}".` }, { status: 404 });

  const [{ data: owner, error: ownerError }, { data: settings, error: settingsError }] = await Promise.all([
    supabase.from("property_owner").select("*").eq("property_id", property.id).maybeSingle(),
    supabase.from("property_finance_settings").select("*").eq("property_id", property.id).maybeSingle(),
  ]);
  if (ownerError) return NextResponse.json({ error: ownerError.message }, { status: 500 });
  if (settingsError) return NextResponse.json({ error: settingsError.message }, { status: 500 });

  return NextResponse.json(
    { property, owner, settings },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
