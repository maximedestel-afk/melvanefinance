import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  const supabase = createAdminClient();
  const sample = await supabase
    .from("property_data")
    .select("*")
    .not("cleaning_provider_id", "is", null)
    .limit(3);

  return NextResponse.json(
    { columns: sample.data?.[0] ? Object.keys(sample.data[0]) : null, sample: sample.data, error: sample.error?.message },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
