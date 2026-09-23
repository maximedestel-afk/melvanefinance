import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const DEFAULT_PASSWORD = "Melvane";

// Crée un compte Supabase Auth (mot de passe par défaut "Melvane") pour
// chaque email distinct de property_owner qui n'en a pas encore — les
// comptes propriétaires n'ont pas de ligne `profiles`, seul leur email les
// identifie côté espace propriétaire (/owner). Idempotent : ignore les
// emails déjà provisionnés.
export async function POST() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  const supabase = createAdminClient();
  const { data: owners, error } = await supabase.from("property_owner").select("email");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const emails = Array.from(
    new Set((owners ?? []).map((o) => (typeof o.email === "string" ? o.email.trim().toLowerCase() : "")).filter((e) => e.includes("@")))
  );

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const email of emails) {
    const { error: createError } = await supabase.auth.admin.createUser({
      email,
      password: DEFAULT_PASSWORD,
      email_confirm: true,
    });
    if (!createError) {
      created++;
    } else if (createError.message.toLowerCase().includes("already been registered") || createError.status === 422) {
      skipped++;
    } else {
      errors.push(`${email}: ${createError.message}`);
    }
  }

  return NextResponse.json({ totalEmails: emails.length, created, skipped, errors });
}
