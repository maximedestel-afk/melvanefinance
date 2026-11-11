import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { isVrPlatformConfigured, listVendorContacts } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";

/** Contacts VRPlatform (vendor) avec nom et email séparés — par opposition
 * à /api/finance/contacts qui ne renvoie qu'un identifiant déjà collapsé
 * (email si connu, sinon nom), utile pour peupler un champ Contact mais pas
 * pour résoudre un nom connu localement vers son email VRPlatform exact. */
export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  if (!isVrPlatformConfigured()) {
    return NextResponse.json({ error: "VRPlatform n'est pas configuré sur ce déploiement." }, { status: 500 });
  }

  try {
    const contacts = await listVendorContacts();
    return NextResponse.json({ contacts }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur inconnue." }, { status: 502 });
  }
}
