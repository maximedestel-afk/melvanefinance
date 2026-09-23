import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  const supabase = createAdminClient();

  const [ownerSample, settingsSample, joinTable] = await Promise.all([
    supabase.from("property_owner").select("*").limit(1),
    supabase.from("property_finance_settings").select("*").limit(1),
    supabase.from("property_cleaning_providers").select("*").limit(5),
  ]);

  return NextResponse.json({
    propertyOwnerColumns: ownerSample.data?.[0] ? Object.keys(ownerSample.data[0]) : null,
    propertyOwnerError: ownerSample.error?.message,
    propertyFinanceSettingsColumns: settingsSample.data?.[0] ? Object.keys(settingsSample.data[0]) : null,
    propertyFinanceSettingsError: settingsSample.error?.message,
    joinTable: { data: joinTable.data, error: joinTable.error?.message },
  });
}
