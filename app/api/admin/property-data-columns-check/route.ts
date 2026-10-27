import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// TEMPORAIRE — diagnostic pour voir les colonnes réelles de property_data
// (table M.G.B partagée, lue par listPropertiesForFinance). On connaît déjà
// bonus_fd_percent (Bonus Ménage) ; on cherche le nom exact de la colonne
// "Bonus ECI %" avant de l'ajouter à l'onglet Comm Sharing.
export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  const supabase = createAdminClient();
  const { data, error } = await supabase.from("property_data").select("*").limit(3);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(
    { columns: data && data.length > 0 ? Object.keys(data[0]) : [], sample: data },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
