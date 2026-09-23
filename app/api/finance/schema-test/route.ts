import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  const supabase = createAdminClient();

  const [providers, propertiesWithProvider, propertiesSample] = await Promise.all([
    supabase.from("cleaning_providers").select("*").limit(5),
    supabase.from("properties").select("id, reference, cleaning_provider_id").limit(5),
    supabase.from("properties").select("*").limit(1),
  ]);

  return NextResponse.json({
    providers: { data: providers.data, error: providers.error?.message },
    propertiesWithProvider: { data: propertiesWithProvider.data, error: propertiesWithProvider.error?.message },
    propertiesSampleColumns: propertiesSample.data?.[0] ? Object.keys(propertiesSample.data[0]) : null,
    propertiesSampleError: propertiesSample.error?.message,
  });
}
