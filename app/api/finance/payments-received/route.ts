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
  const { data, error: dbError } = await supabase.from("reservation_payments_received").select("confirmation_code, received");
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({
    receivedConfirmationCodes: (data ?? []).filter((r) => r.received).map((r) => r.confirmation_code),
  });
}

export async function PUT(request: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  const body = await request.json();
  const confirmationCode = typeof body.confirmationCode === "string" ? body.confirmationCode : null;
  const received = typeof body.received === "boolean" ? body.received : null;
  if (!confirmationCode || received === null) {
    return NextResponse.json({ error: "confirmationCode ou received invalide." }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { error: dbError } = await supabase
    .from("reservation_payments_received")
    .upsert({ confirmation_code: confirmationCode, received, updated_at: new Date().toISOString() }, { onConflict: "confirmation_code" });
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
