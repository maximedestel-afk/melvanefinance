import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const BUCKET = "bank-statements";

/** URL signée (5 min) pour consulter/télécharger un fichier (WISE ou VR) —
 * le bucket est privé, donc impossible d'y accéder directement par URL. */
export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  const path = new URL(request.url).searchParams.get("path");
  if (!path) return NextResponse.json({ error: "Paramètre 'path' requis." }, { status: 400 });

  const supabase = createAdminClient();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ url: data.signedUrl });
}
