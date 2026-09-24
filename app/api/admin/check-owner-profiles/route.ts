import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// TEMPORAIRE — vérifie si les comptes propriétaires provisionnés (créés via
// /api/admin/provision-owners) ont hérité d'une ligne `profiles` (et d'un
// rôle admin) côté M.G.B, ce qui ne devrait jamais arriver. À retirer une
// fois l'investigation terminée.
export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  const supabase = createAdminClient();
  const { data: owners, error: ownersError } = await supabase.from("property_owner").select("email");
  if (ownersError) return NextResponse.json({ error: ownersError.message }, { status: 500 });

  const ownerEmails = Array.from(
    new Set((owners ?? []).map((o) => (typeof o.email === "string" ? o.email.trim().toLowerCase() : "")).filter((e) => e.includes("@")))
  );

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, email, role, full_name")
    .in("email", ownerEmails);
  if (profilesError) return NextResponse.json({ error: profilesError.message }, { status: 500 });

  return NextResponse.json(
    {
      ownerEmailsChecked: ownerEmails.length,
      profilesFoundForOwnerEmails: profiles ?? [],
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
