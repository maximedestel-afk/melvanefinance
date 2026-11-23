import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { getWiseActivityRows, getWiseProfiles, isWiseConfigured } from "@/lib/wise";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Flux d'activité Wise en direct (tous comptes/devises confondus, voir
 * lib/wise.ts) sur [startDate, endDate] — ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD.
 * Alimente l'onglet Relevé Bancaire (BankStatementCsvTable.tsx) en
 * alternative à l'upload manuel d'un CSV Wise. */
export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });
  if (!isWiseConfigured()) {
    return NextResponse.json({ error: "Wise n'est pas configuré sur ce déploiement (WISE_API_KEY manquant)." }, { status: 500 });
  }

  const searchParams = new URL(request.url).searchParams;
  const startDate = searchParams.get("startDate") ?? "";
  const endDate = searchParams.get("endDate") ?? "";
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate) || startDate > endDate) {
    return NextResponse.json({ error: "Plage de dates invalide (startDate/endDate, YYYY-MM-DD)." }, { status: 400 });
  }

  try {
    const profiles = await getWiseProfiles();
    const businessProfile = profiles.find((p) => p.type === "business") ?? profiles[0] ?? null;
    if (!businessProfile) {
      return NextResponse.json({ error: "Aucun profil Wise trouvé pour ce token." }, { status: 404 });
    }

    const since = `${startDate}T00:00:00.000Z`;
    // endDate incluse — borne jusqu'à la fin de la journée.
    const until = `${endDate}T23:59:59.999Z`;
    const rows = await getWiseActivityRows(businessProfile.id, since, until);

    return NextResponse.json({ rows }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur Wise inconnue." },
      { status: 502 }
    );
  }
}
