import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { getVendorExpenses, isVrPlatformConfigured } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Factures (transactions "expense") d'un vendor VRPlatform donné sur une
 * période — ?contactId=...&status=unpaid|paid|both, et soit
 * (&year=...&month=...) soit (&startDate=...&endDate=...). Onglet
 * Supplier. */
export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  if (!isVrPlatformConfigured()) {
    return NextResponse.json({ error: "VRPlatform n'est pas configuré sur ce déploiement." }, { status: 500 });
  }

  const searchParams = new URL(request.url).searchParams;
  const contactId = searchParams.get("contactId");
  if (!contactId) {
    return NextResponse.json({ error: "Paramètre 'contactId' requis." }, { status: 400 });
  }

  const statusParam = searchParams.get("status") ?? "unpaid";
  if (statusParam !== "unpaid" && statusParam !== "paid" && statusParam !== "both") {
    return NextResponse.json({ error: "Paramètre 'status' invalide (unpaid, paid ou both)." }, { status: 400 });
  }

  const year = searchParams.get("year");
  const month = searchParams.get("month");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  let dateRange: string;
  if (year && month) {
    const monthNum = Number.parseInt(month, 10);
    if (!Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12) {
      return NextResponse.json({ error: "Paramètre 'month' invalide (1-12)." }, { status: 400 });
    }
    dateRange = `${year}-${String(monthNum).padStart(2, "0")}`;
  } else if (startDate && endDate) {
    if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate) || startDate > endDate) {
      return NextResponse.json({ error: "Plage de dates invalide." }, { status: 400 });
    }
    dateRange = `${startDate}...${endDate}`;
  } else {
    return NextResponse.json(
      { error: "Fournis soit 'year' et 'month', soit 'startDate' et 'endDate'." },
      { status: 400 }
    );
  }

  try {
    const expenses = await getVendorExpenses(contactId, dateRange, statusParam);
    return NextResponse.json({ expenses }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur VRPlatform inconnue." },
      { status: 502 }
    );
  }
}
