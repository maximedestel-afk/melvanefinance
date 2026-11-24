import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// TEMPORAIRE — diagnostic pour voir si commission_percent=25 sur 145STDO est
// une valeur isolée ou le taux "standard" répété sur la plupart des biens,
// indépendamment du rent_type (ce qui expliquerait que ce soit un taux
// contractuel standard recopié systématiquement, même pour un loyer fixe
// où il n'est jamais utilisé dans les calculs).
export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  const supabase = createAdminClient();
  const [{ data: properties, error: propertiesError }, { data: owners, error: ownersError }] = await Promise.all([
    supabase.from("properties").select("id, reference"),
    supabase.from("property_owner").select("property_id, rent_type, commission_percent, updated_at"),
  ]);
  if (propertiesError) return NextResponse.json({ error: propertiesError.message }, { status: 500 });
  if (ownersError) return NextResponse.json({ error: ownersError.message }, { status: 500 });

  const referenceById = new Map((properties ?? []).map((p) => [p.id, p.reference]));
  const rows = (owners ?? []).map((o) => ({
    reference: referenceById.get(o.property_id) ?? o.property_id,
    rentType: o.rent_type,
    commissionPercent: o.commission_percent,
    updatedAt: o.updated_at,
  }));

  const distribution = new Map<string, number>();
  for (const r of rows) {
    const key = r.commissionPercent == null ? "null" : String(r.commissionPercent);
    distribution.set(key, (distribution.get(key) ?? 0) + 1);
  }

  return NextResponse.json(
    {
      totalRows: rows.length,
      distribution: Object.fromEntries(distribution),
      rows: rows.sort((a, b) => a.reference.localeCompare(b.reference)),
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
