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
// comptes propriétaires ne doivent avoir accès qu'à l'espace propriétaire
// (/owner), jamais à M.G.B. Idempotent : ignore les emails déjà provisionnés.
//
// M.G.B a un mécanisme (probablement un trigger sur auth.users) qui crée
// automatiquement une ligne `profiles` en rôle admin pour tout nouvel
// utilisateur Auth — ça a donné un accès admin M.G.B involontaire aux
// premiers comptes propriétaires créés ici. Comme /owner ne lit jamais
// `profiles` (seulement l'email dans property_owner), on supprime
// systématiquement toute ligne `profiles` correspondant à un email
// propriétaire après provisioning, pour neutraliser ce trigger.
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

  const { data: removedProfiles, error: cleanupError } = await supabase
    .from("profiles")
    .delete()
    .in("email", emails)
    .select("email");
  if (cleanupError) errors.push(`Nettoyage profils : ${cleanupError.message}`);

  return NextResponse.json({
    totalEmails: emails.length,
    created,
    skipped,
    profilesRemoved: removedProfiles?.length ?? 0,
    errors,
  });
}
