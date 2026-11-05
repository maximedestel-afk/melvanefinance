import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BUCKET = "bank-statements";

async function requireAdmin() {
  const profile = await getCurrentProfile();
  if (!profile) return { error: NextResponse.json({ error: "Non authentifié." }, { status: 401 }) };
  if (profile.role !== "admin") return { error: NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 }) };
  return { error: null };
}

/** Liste des relevés bancaires convertis, les plus récents en premier. */
export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const supabase = createAdminClient();
  const { data, error: dbError } = await supabase
    .from("bank_statement_conversions")
    .select("id, wise_file_path, wise_file_name, vr_file_path, vr_file_name, row_count, created_at")
    .order("created_at", { ascending: false });
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json(
    {
      conversions: (data ?? []).map((row) => ({
        id: row.id,
        wiseFilePath: row.wise_file_path,
        wiseFileName: row.wise_file_name,
        vrFilePath: row.vr_file_path,
        vrFileName: row.vr_file_name,
        rowCount: row.row_count,
        createdAt: row.created_at,
      })),
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}

/** Enregistre une conversion : multipart/form-data avec le CSV WISE original
 * (`wiseFile`) et le CSV VR déjà converti côté client (`vrFile`), tous deux
 * uploadés dans le bucket Storage privé "bank-statements". */
export async function POST(request: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  const form = await request.formData();
  const wiseFile = form.get("wiseFile");
  const vrFile = form.get("vrFile");
  const rowCountRaw = form.get("rowCount");

  if (!(wiseFile instanceof File) || !(vrFile instanceof File)) {
    return NextResponse.json({ error: "Fichiers WISE et VR requis." }, { status: 400 });
  }
  const rowCount = Number.parseInt(String(rowCountRaw ?? ""), 10);
  if (!Number.isInteger(rowCount) || rowCount < 0) {
    return NextResponse.json({ error: "Nombre de lignes invalide." }, { status: 400 });
  }

  const supabase = createAdminClient();
  const prefix = crypto.randomUUID();
  const wisePath = `${prefix}-wise-${wiseFile.name}`;
  const vrPath = `${prefix}-vr-${vrFile.name}`;

  const { error: wiseUploadError } = await supabase.storage
    .from(BUCKET)
    .upload(wisePath, await wiseFile.arrayBuffer(), { contentType: wiseFile.type || "text/csv" });
  if (wiseUploadError) return NextResponse.json({ error: `Upload WISE échoué : ${wiseUploadError.message}` }, { status: 500 });

  const { error: vrUploadError } = await supabase.storage
    .from(BUCKET)
    .upload(vrPath, await vrFile.arrayBuffer(), { contentType: vrFile.type || "text/csv" });
  if (vrUploadError) {
    await supabase.storage.from(BUCKET).remove([wisePath]);
    return NextResponse.json({ error: `Upload VR échoué : ${vrUploadError.message}` }, { status: 500 });
  }

  const { data, error: dbError } = await supabase
    .from("bank_statement_conversions")
    .insert({
      wise_file_path: wisePath,
      wise_file_name: wiseFile.name,
      vr_file_path: vrPath,
      vr_file_name: vrFile.name,
      row_count: rowCount,
    })
    .select("id")
    .single();
  if (dbError) {
    await supabase.storage.from(BUCKET).remove([wisePath, vrPath]);
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  return NextResponse.json({ id: data.id }, { status: 201 });
}
