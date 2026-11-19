import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { getPropertyFinanceLineDetail, isVrPlatformConfigured } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Détail écriture par écriture de Markup ou Manager Expense pour un bien —
 * ?references=REF1,REF2&kind=markup|managerExpense&year=YYYY&months=1,3,11.
 * Onglet Revenus, au clic sur ces deux colonnes. */
export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  if (!isVrPlatformConfigured()) {
    return NextResponse.json({ error: "VRPlatform n'est pas configuré sur ce déploiement." }, { status: 500 });
  }

  const searchParams = new URL(request.url).searchParams;
  const referencesParam = searchParams.get("references");
  const kind = searchParams.get("kind");
  const yearParam = searchParams.get("year");
  const monthsParam = searchParams.get("months");
  const year = yearParam ? Number.parseInt(yearParam, 10) : NaN;
  if (!referencesParam || (kind !== "markup" && kind !== "managerExpense") || !Number.isInteger(year) || !monthsParam) {
    return NextResponse.json(
      { error: "Paramètres 'references', 'kind', 'year' et 'months' requis." },
      { status: 400 }
    );
  }
  const months = new Set(
    monthsParam
      .split(",")
      .map((m) => Number.parseInt(m, 10))
      .filter((m) => Number.isInteger(m))
  );

  try {
    const entries = await getPropertyFinanceLineDetail(referencesParam.split(",").filter(Boolean), kind, String(year));
    const filtered = entries.filter((e) => months.has(Number(e.date.slice(5, 7))));
    return NextResponse.json({ entries: filtered }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur VRPlatform inconnue." },
      { status: 502 }
    );
  }
}
