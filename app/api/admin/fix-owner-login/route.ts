import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const DEFAULT_PASSWORD = "Melvane";

// TEMPORAIRE — diagnostique puis répare la connexion d'un compte propriétaire
// (état Supabase Auth réel + réinitialisation du mot de passe par défaut).
// À retirer une fois l'investigation terminée.
export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  const email = new URL(request.url).searchParams.get("email")?.trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "Paramètre ?email= requis." }, { status: 400 });

  const supabase = createAdminClient();
  let page = 1;
  let found: { id: string; email: string | undefined; email_confirmed_at: string | null | undefined; banned_until: string | null | undefined; last_sign_in_at: string | null | undefined; created_at: string } | null = null;

  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const match = data.users.find((u) => u.email?.toLowerCase() === email);
    if (match) {
      found = {
        id: match.id,
        email: match.email,
        email_confirmed_at: match.email_confirmed_at,
        banned_until: (match as unknown as { banned_until?: string | null }).banned_until,
        last_sign_in_at: match.last_sign_in_at,
        created_at: match.created_at,
      };
      break;
    }
    if (data.users.length < 200) break;
    page++;
  }

  if (!found) return NextResponse.json({ error: `Aucun utilisateur Auth trouvé pour ${email}.` });

  return NextResponse.json({ user: found });
}

// Réinitialise le mot de passe au défaut "Melvane" et force l'email confirmé
// — couvre les causes les plus probables d'un login qui échoue.
export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  const email = new URL(request.url).searchParams.get("email")?.trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "Paramètre ?email= requis." }, { status: 400 });

  const supabase = createAdminClient();
  let page = 1;
  let userId: string | null = null;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const match = data.users.find((u) => u.email?.toLowerCase() === email);
    if (match) {
      userId = match.id;
      break;
    }
    if (data.users.length < 200) break;
    page++;
  }
  if (!userId) return NextResponse.json({ error: `Aucun utilisateur Auth trouvé pour ${email}.` });

  const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
    password: DEFAULT_PASSWORD,
    email_confirm: true,
    ban_duration: "none",
  });
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  return NextResponse.json({ ok: true, email, userId });
}
