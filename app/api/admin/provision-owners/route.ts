import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const DEFAULT_PASSWORD = "Melvane";

// Diagnostic : combien de biens ont (ou n'ont pas) un email propriétaire
// exploitable côté M.G.B, avant de lancer la création des comptes.
export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  const supabase = createAdminClient();
  const [{ data: owners, error: ownersError }, { data: properties, error: propertiesError }] = await Promise.all([
    supabase.from("property_owner").select("property_id, email"),
    supabase.from("properties").select("id, reference"),
  ]);
  if (ownersError) return NextResponse.json({ error: ownersError.message }, { status: 500 });
  if (propertiesError) return NextResponse.json({ error: propertiesError.message }, { status: 500 });

  const referenceById = new Map((properties ?? []).map((p) => [p.id, p.reference]));
  const withEmail: string[] = [];
  const missingEmailReferences: string[] = [];

  for (const owner of owners ?? []) {
    const email = typeof owner.email === "string" ? owner.email.trim() : "";
    const reference = referenceById.get(owner.property_id) ?? owner.property_id;
    if (email.includes("@")) withEmail.push(email.toLowerCase());
    else missingEmailReferences.push(reference);
  }

  return NextResponse.json({
    totalProperties: properties?.length ?? 0,
    totalOwnerRows: owners?.length ?? 0,
    withEmailCount: withEmail.length,
    distinctEmailCount: new Set(withEmail).size,
    missingEmailReferences,
  });
}

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
