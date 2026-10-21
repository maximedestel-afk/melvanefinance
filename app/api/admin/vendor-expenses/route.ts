import { NextResponse } from "next/server";
import { getCurrentProfile, listPropertiesForFinance } from "@/lib/queries";
import { getPortfolioExpenseEntriesByVendor, isVrPlatformConfigured } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function formatEuros(cents: number): string {
  return (cents / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

/** Tableau HTML, sur le portefeuille entier, de toutes les écritures de
 * dépense dont la description contient un prestataire donné (ex: Sweepit) —
 * ?vendor=sweepit&year=2026&months=10. Défaut : Sweepit, mois en cours. */
export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });
  if (!isVrPlatformConfigured()) {
    return NextResponse.json({ error: "VRPlatform n'est pas configuré sur ce déploiement." }, { status: 500 });
  }

  const searchParams = new URL(request.url).searchParams;
  const vendor = searchParams.get("vendor") ?? "sweepit";
  const now = new Date();
  const year = Number.parseInt(searchParams.get("year") ?? "", 10) || now.getUTCFullYear();
  const monthsParam = searchParams.get("months");
  const months = monthsParam
    ? monthsParam
        .split(",")
        .map((m) => Number.parseInt(m, 10))
        .filter((m) => Number.isInteger(m) && m >= 1 && m <= 12)
    : [now.getUTCMonth() + 1];

  try {
    const properties = await listPropertiesForFinance();
    const rows = await getPortfolioExpenseEntriesByVendor(
      properties.map((p) => ({
        propertyId: p.id,
        reference: p.reference,
        name: p.name,
        rentType: p.rentType,
        rentAmount: p.rentAmount,
        commissionPercent: p.commissionPercent,
        extraVrplatformReferences: p.extraVrplatformReferences,
      })),
      year,
      months,
      vendor
    );

    const totalCents = rows.reduce((sum, r) => sum + r.cents, 0);
    const periodLabel = `${months.map((m) => String(m).padStart(2, "0")).join(",")}/${year}`;

    const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Expenses ${escapeHtml(vendor)} — ${escapeHtml(periodLabel)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; color: #1d1d1f; background: #fff; }
  caption { text-align: left; margin-bottom: 14px; font-size: 18px; font-weight: 600; caption-side: top; }
  table { border-collapse: collapse; width: 100%; max-width: 900px; font-size: 14px; }
  th, td { border-bottom: 1px solid #e5e5e5; padding: 7px 12px; text-align: left; }
  th { background: #f5f5f7; font-weight: 600; }
  td.num, tfoot td.num { text-align: right; font-variant-numeric: tabular-nums; }
  tfoot td { font-weight: 700; border-top: 2px solid #1d1d1f; border-bottom: none; }
  .empty { color: #6e6e73; }
</style>
</head>
<body>
<table>
  <caption>${escapeHtml(vendor)} — ${rows.length} écriture${rows.length > 1 ? "s" : ""} — ${escapeHtml(periodLabel)}</caption>
  <thead><tr><th>Bien</th><th>Date</th><th>Compte</th><th>Description</th><th>Montant</th></tr></thead>
  <tbody>
    ${
      rows.length > 0
        ? rows
            .map(
              (r) =>
                `<tr><td>${escapeHtml(r.reference)}</td><td>${escapeHtml(r.date)}</td><td>${escapeHtml(r.accountName)}</td><td>${escapeHtml(r.description ?? "—")}</td><td class="num">${formatEuros(r.cents)}</td></tr>`
            )
            .join("\n    ")
        : `<tr><td colspan="5" class="empty">Aucune écriture trouvée.</td></tr>`
    }
  </tbody>
  ${rows.length > 0 ? `<tfoot><tr><td colspan="4">Total</td><td class="num">${formatEuros(totalCents)}</td></tr></tfoot>` : ""}
</table>
</body>
</html>`;

    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store, max-age=0" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur VRPlatform inconnue." },
      { status: 502 }
    );
  }
}
