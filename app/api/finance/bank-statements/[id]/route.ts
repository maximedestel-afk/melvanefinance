import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const BUCKET = "bank-statements";

/** Supprime une conversion de relevé bancaire et ses deux fichiers associés
 * (WISE + VR). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });
  const { id } = await params;

  const supabase = createAdminClient();
  const { data, error: fetchError } = await supabase
    .from("bank_statement_conversions")
    .select("wise_file_path, vr_file_path")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });

  const { error: dbError } = await supabase.from("bank_statement_conversions").delete().eq("id", id);
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  if (data) await supabase.storage.from(BUCKET).remove([data.wise_file_path, data.vr_file_path]);

  return NextResponse.json({ ok: true });
}
