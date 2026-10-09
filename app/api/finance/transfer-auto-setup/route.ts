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
  const { data, error: dbError } = await supabase.from("property_transfer_auto_setup").select("property_id, enabled");
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({
    enabledPropertyIds: (data ?? []).filter((r) => r.enabled).map((r) => r.property_id),
  });
}

export async function PUT(request: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  const body = await request.json();
  const propertyId = typeof body.propertyId === "string" ? body.propertyId : null;
  const enabled = typeof body.enabled === "boolean" ? body.enabled : null;
  if (!propertyId || enabled === null) {
    return NextResponse.json({ error: "propertyId ou enabled invalide." }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { error: dbError } = await supabase
    .from("property_transfer_auto_setup")
    .upsert({ property_id: propertyId, enabled, updated_at: new Date().toISOString() }, { onConflict: "property_id" });
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
