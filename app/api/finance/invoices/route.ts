import { NextResponse } from "next/server";
import { getCurrentProfile, listPropertiesForFinance } from "@/lib/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BUCKET = "supplier-invoices";

async function requireAdmin() {
  const profile = await getCurrentProfile();
  if (!profile) return { error: NextResponse.json({ error: "Non authentifié." }, { status: 401 }) };
  if (profile.role !== "admin") return { error: NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 }) };
  return { error: null };
}

/** Liste des factures fournisseur, les plus récentes en premier. */
export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const supabase = createAdminClient();
  const { data, error: dbError } = await supabase
    .from("supplier_invoices")
    .select("id, supplier_name, amount_cents, invoice_date, invoice_number, property_id, file_path, file_name, paid, notes, created_at")
    .order("invoice_date", { ascending: false, nullsFirst: false });
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  const properties = await listPropertiesForFinance();
  const referenceByPropertyId = new Map(properties.map((p) => [p.id, p.reference]));

  return NextResponse.json(
    {
      invoices: (data ?? []).map((row) => ({
        id: row.id,
        supplierName: row.supplier_name,
        amountCents: row.amount_cents,
        invoiceDate: row.invoice_date,
        invoiceNumber: row.invoice_number,
        propertyId: row.property_id,
        propertyReference: row.property_id ? (referenceByPropertyId.get(row.property_id) ?? null) : null,
        filePath: row.file_path,
        fileName: row.file_name,
        paid: row.paid,
        notes: row.notes,
        createdAt: row.created_at,
      })),
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}

/** Crée une facture : multipart/form-data avec le fichier (`file`) + les
 * champs (supplierName, amountCents, invoiceDate, invoiceNumber, propertyId,
 * notes) — le fichier est uploadé dans le bucket Storage privé
 * "supplier-invoices" avant d'insérer la ligne. */
export async function POST(request: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  const form = await request.formData();
  const file = form.get("file");
  const supplierName = form.get("supplierName");
  const amountCentsRaw = form.get("amountCents");
  const invoiceDate = form.get("invoiceDate");
  const invoiceNumber = form.get("invoiceNumber");
  const propertyId = form.get("propertyId");
  const notes = form.get("notes");

  if (!(file instanceof File) || typeof supplierName !== "string" || supplierName.trim() === "") {
    return NextResponse.json({ error: "Fichier et fournisseur requis." }, { status: 400 });
  }
  const amountCents = Number.parseInt(String(amountCentsRaw ?? ""), 10);
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    return NextResponse.json({ error: "Montant invalide." }, { status: 400 });
  }

  const supabase = createAdminClient();
  const filePath = `${crypto.randomUUID()}-${file.name}`;
  const fileBuffer = await file.arrayBuffer();
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(filePath, fileBuffer, {
    contentType: file.type || "application/octet-stream",
  });
  if (uploadError) return NextResponse.json({ error: `Upload échoué : ${uploadError.message}` }, { status: 500 });

  const { data, error: dbError } = await supabase
    .from("supplier_invoices")
    .insert({
      supplier_name: supplierName.trim(),
      amount_cents: amountCents,
      invoice_date: typeof invoiceDate === "string" && invoiceDate !== "" ? invoiceDate : null,
      invoice_number: typeof invoiceNumber === "string" && invoiceNumber !== "" ? invoiceNumber : null,
      property_id: typeof propertyId === "string" && propertyId !== "" ? propertyId : null,
      notes: typeof notes === "string" && notes !== "" ? notes : null,
      file_path: filePath,
      file_name: file.name,
      paid: false,
    })
    .select("id")
    .single();
  if (dbError) {
    await supabase.storage.from(BUCKET).remove([filePath]);
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  return NextResponse.json({ id: data.id }, { status: 201 });
}
