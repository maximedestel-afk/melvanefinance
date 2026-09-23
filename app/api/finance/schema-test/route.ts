import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { supabaseUrl } from "@/lib/supabase/env";

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY manquant." }, { status: 500 });

  // Le endpoint racine PostgREST renvoie le schéma OpenAPI complet, colonnes
  // incluses — plus fiable que de deviner des noms de table un par un.
  const res = await fetch(`${supabaseUrl()}/rest/v1/`, {
    headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` },
    cache: "no-store",
  });
  const schema = await res.json();
  const tablesOfInterest = ["tasks", "profile_properties", "cleaning_providers", "profiles"];
  const columnsByTable = Object.fromEntries(
    tablesOfInterest.map((t) => [
      t,
      schema.definitions?.[t] ? Object.keys(schema.definitions[t].properties ?? {}) : null,
    ])
  );

  return NextResponse.json({ columnsByTable });
}
