import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { commSharingBoardLabel, getCommSharingRows, isMondayConfigured } from "@/lib/monday";
import { getRecordedEarlyCheckinDescriptions, isVrPlatformConfigured } from "@/lib/vrplatform";

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
    // Recoupement VRPlatform (compte Early Check-ins) pour repérer les
    // lignes déjà enregistrées côté export Expense — dégradation
    // silencieuse si VRPlatform n'est pas configuré ou indisponible,
    // puisque c'est un recoupement en plus, pas la donnée principale.
    let alreadyRecordedDescriptions: string[] = [];
    if (isVrPlatformConfigured()) {
      try {
        alreadyRecordedDescriptions = Array.from(await getRecordedEarlyCheckinDescriptions(year, month));
      } catch {
        alreadyRecordedDescriptions = [];
      }
    }

    return NextResponse.json(
      { year, month, rows, alreadyRecordedDescriptions },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur Monday.com inconnue." },
      { status: 502 }
    );
  }
}
