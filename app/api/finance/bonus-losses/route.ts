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
    .from("bonus_menage_losses")
    .select("id, name, amount_cents, created_at")
    .order("created_at", { ascending: true });
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({
    losses: (data ?? []).map((l) => ({ id: l.id, name: l.name, amountCents: l.amount_cents })),
  });
}

export async function POST(request: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  const body = await request.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const amountCents = Number(body.amountCents);
  if (!name || !Number.isFinite(amountCents) || amountCents <= 0) {
    return NextResponse.json({ error: "Nom ou montant invalide." }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error: dbError } = await supabase
    .from("bonus_menage_losses")
    .insert({ name, amount_cents: Math.round(amountCents) })
    .select("id, name, amount_cents")
    .single();
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({ loss: { id: data.id, name: data.name, amountCents: data.amount_cents } });
}

export async function DELETE(request: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "ID manquant." }, { status: 400 });

  const supabase = createAdminClient();
  const { error: dbError } = await supabase.from("bonus_menage_losses").delete().eq("id", id);
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
