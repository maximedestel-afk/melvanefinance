import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  const supabase = createAdminClient();

  const candidates = [
    "property_cleaning_provider",
    "property_cleaning_providers",
    "cleaning_assignments",
    "cleaning_provider_assignments",
    "property_prestataires",
    "property_prestataire",
    "prestataires_menage",
    "cleaning_schedule",
    "cleaning_tasks",
    "interventions_menage",
    "menage_assignments",
    "property_settings",
    "property_details",
  ];

  const results = await Promise.all(
    candidates.map(async (table) => {
      const res = await supabase.from(table).select("*").limit(1);
      return {
        table,
        exists: !res.error,
        columns: res.data?.[0] ? Object.keys(res.data[0]) : null,
        error: res.error?.message,
      };
    })
  );

  return NextResponse.json({ results });
}
