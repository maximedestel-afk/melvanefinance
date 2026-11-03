import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const BUCKET = "supplier-invoices";

async function requireAdmin() {
  const profile = await getCurrentProfile();
  if (!profile) return { error: NextResponse.json({ error: "Non authentifié." }, { status: 401 }) };
  if (profile.role !== "admin") return { error: NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 }) };
  return { error: null };
}

/** Met à jour le statut payée/non payée (ou d'autres champs) d'une facture. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAdmin();
  if (error) return error;
  const { id } = await params;

  const body = await request.json();
  const update: Record<string, unknown> = {};
  if (typeof body.paid === "boolean") update.paid = body.paid;
  if (typeof body.notes === "string") update.notes = body.notes;
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Aucun champ à mettre à jour." }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { error: dbError } = await supabase.from("supplier_invoices").update(update).eq("id", id);
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

/** Supprime une facture et son fichier associé. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAdmin();
  if (error) return error;
  const { id } = await params;

  const supabase = createAdminClient();
  const { data, error: fetchError } = await supabase.from("supplier_invoices").select("file_path").eq("id", id).maybeSingle();
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });

  const { error: dbError } = await supabase.from("supplier_invoices").delete().eq("id", id);
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  if (data?.file_path) await supabase.storage.from(BUCKET).remove([data.file_path]);

  return NextResponse.json({ ok: true });
}
