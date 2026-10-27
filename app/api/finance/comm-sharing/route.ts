import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { commSharingBoardLabel, getCommSharingRows, isMondayConfigured } from "@/lib/monday";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Lignes du tableau Monday.com "Comm Sharing" (facturation Sweep It) du
 * mois demandé — ?year=2026&month=10. */
export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });
  if (!isMondayConfigured()) {
    return NextResponse.json({ error: "Monday.com n'est pas configuré sur ce déploiement (MONDAY_API_TOKEN manquant)." }, { status: 500 });
  }

  const searchParams = new URL(request.url).searchParams;
  const year = Number.parseInt(searchParams.get("year") ?? "", 10);
  const month = Number.parseInt(searchParams.get("month") ?? "", 10);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "Paramètres 'year' et 'month' (1-12) requis." }, { status: 400 });
  }

  try {
    const rows = await getCommSharingRows(year, month);
    if (rows === null) {
      return NextResponse.json(
        { error: `Aucun tableau Monday.com nommé "${commSharingBoardLabel(year, month)}" trouvé.` },
        { status: 404 }
      );
    }
    return NextResponse.json({ year, month, rows }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur Monday.com inconnue." },
      { status: 502 }
    );
  }
}
