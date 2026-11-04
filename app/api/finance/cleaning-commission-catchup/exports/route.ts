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

/** Réservations déjà marquées comme exportées (pour saisie manuelle de
 * l'écriture de rattrapage dans VRPlatform) parmi celles demandées. */
export async function GET(request: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  const reservationIdsParam = new URL(request.url).searchParams.get("reservationIds");
  if (!reservationIdsParam) return NextResponse.json({ exports: [] });

  const supabase = createAdminClient();
  const { data, error: dbError } = await supabase
    .from("cleaning_commission_catchup_exports")
    .select("reservation_id, exported_at")
    .in("reservation_id", reservationIdsParam.split(","));
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json(
    { exports: data.map((e) => ({ reservationId: e.reservation_id, exportedAt: e.exported_at })) },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}

interface ExportRowInput {
  reservationId: string;
  propertyId: string;
  propertyReference: string;
  checkoutDate: string;
  commissionOnCleaningCents: number;
  additionalCommissionCents: number;
  pnlCents: number;
}

/** Marque une sélection de réservations comme exportées (écriture de
 * rattrapage ménage posée à la main dans VRPlatform) — upsert par
 * reservation_id, pour pouvoir re-marquer (exported_at mis à jour) sans
 * dupliquer la ligne. */
export async function POST(request: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  const body = await request.json();
  const rows: ExportRowInput[] = Array.isArray(body.rows) ? body.rows : [];
  if (rows.length === 0) return NextResponse.json({ error: "Aucune ligne à marquer." }, { status: 400 });

  const supabase = createAdminClient();
  const { error: dbError } = await supabase.from("cleaning_commission_catchup_exports").upsert(
    rows.map((r) => ({
      reservation_id: r.reservationId,
      property_id: r.propertyId,
      property_reference: r.propertyReference,
      checkout_date: r.checkoutDate,
      commission_on_cleaning_cents: r.commissionOnCleaningCents,
      additional_commission_cents: r.additionalCommissionCents,
      pnl_cents: r.pnlCents,
      exported_at: new Date().toISOString(),
    })),
    { onConflict: "reservation_id" }
  );
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

/** Annule le marquage "exporté" d'une sélection de réservations. */
export async function DELETE(request: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  const reservationIdsParam = new URL(request.url).searchParams.get("reservationIds");
  if (!reservationIdsParam) return NextResponse.json({ error: "Aucune ligne à annuler." }, { status: 400 });

  const supabase = createAdminClient();
  const { error: dbError } = await supabase
    .from("cleaning_commission_catchup_exports")
    .delete()
    .in("reservation_id", reservationIdsParam.split(","));
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
