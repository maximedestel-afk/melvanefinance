import { NextResponse } from "next/server";
import { getCurrentProfile, listPropertiesForFinance } from "@/lib/queries";
import { getPortfolioBookingWindowStats, isVrPlatformConfigured } from "@/lib/vrplatform";
import { getGuestyCalendarMonth, isGuestyConfigured, mapWithGuestyConcurrency } from "@/lib/guesty";

export const dynamic = "force-dynamic";

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** TR d'une fenêtre de jours à partir du calendrier Guesty : occupé ÷
 * (occupé + libre), les nuits bloquées manuellement n'entrant ni au
 * numérateur ni au dénominateur — même logique que l'onglet Analyse. */
function fillRateFromCalendar(days: { status: "available" | "occupied" | "blocked" }[]): number | null {
  const occupied = days.filter((d) => d.status === "occupied").length;
  const free = days.filter((d) => d.status === "available").length;
  const rentable = occupied + free;
  return rentable > 0 ? occupied / rentable : null;
}

/** Fenêtre de réservation médiane et durée moyenne de séjour (12 derniers
 * mois glissants, voir getPortfolioBookingWindowStats) pour chaque bien du
 * portefeuille — utilisé par les onglets Remplissage et Tendances.
 * `includeShortTermFillRate=1` ajoute le TR des 15 prochains jours et des
 * 15 jours suivants (calendrier Guesty), pour repérer un bien qui se remplit
 * moins vite que d'habitude à court terme — utilisé par l'onglet Tendances
 * uniquement (coûte un appel Guesty par bien, désactivé par défaut). */
export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });
  if (!isVrPlatformConfigured()) {
    return NextResponse.json({ error: "VRPlatform n'est pas configuré sur ce déploiement." }, { status: 500 });
  }

  const searchParams = new URL(request.url).searchParams;
  const propertyIdsParam = searchParams.get("propertyIds");
  const propertyIds = propertyIdsParam ? new Set(propertyIdsParam.split(",")) : null;
  const includeShortTermFillRate = searchParams.get("includeShortTermFillRate") === "1";

  try {
    const allProperties = await listPropertiesForFinance();
    const properties = propertyIds ? allProperties.filter((p) => propertyIds.has(p.id)) : allProperties;
    if (propertyIds && properties.length === 0) {
      return NextResponse.json({ error: "Aucun bien ne correspond aux filtres." }, { status: 404 });
    }

    const results = await getPortfolioBookingWindowStats(
      properties.map((p) => ({
        propertyId: p.id,
        reference: p.reference,
        name: p.name,
        rentType: p.rentType,
        rentAmount: p.rentAmount,
        commissionPercent: p.commissionPercent,
        extraVrplatformReferences: p.extraVrplatformReferences,
      }))
    );

    if (!includeShortTermFillRate || !isGuestyConfigured()) {
      return NextResponse.json({ properties: results }, { headers: { "Cache-Control": "no-store, max-age=0" } });
    }

    const today = new Date();
    const windowAStart = isoDate(today);
    const windowAEnd = isoDate(addDays(today, 14));
    const windowBStart = isoDate(addDays(today, 15));
    const windowBEnd = isoDate(addDays(today, 29));

    const withFillRate = await mapWithGuestyConcurrency(results, async (r) => {
      if (!r.guestyListingId) {
        return { ...r, next15DaysFillRate: null, next15To30DaysFillRate: null };
      }
      try {
        const [daysA, daysB] = await Promise.all([
          getGuestyCalendarMonth(r.guestyListingId, windowAStart, windowAEnd),
          getGuestyCalendarMonth(r.guestyListingId, windowBStart, windowBEnd),
        ]);
        return {
          ...r,
          next15DaysFillRate: fillRateFromCalendar(daysA),
          next15To30DaysFillRate: fillRateFromCalendar(daysB),
        };
      } catch {
        return { ...r, next15DaysFillRate: null, next15To30DaysFillRate: null };
      }
    });

    return NextResponse.json({ properties: withFillRate }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur VRPlatform inconnue." },
      { status: 502 }
    );
  }
}
