import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { getAllGuestyReservationsRaw } from "@/lib/guesty";
import { listAllVrPlatformListingsAnyStatus } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";

// TEMPORAIRE — diagnostic pour comparer, réservation par réservation, les
// différents champs financiers Guesty candidats (commission, commissionIncTax,
// ownerRevenue, markup...) sur UN SEUL listing Moret, face au montant réel vu
// dans Guesty par l'utilisateur. getGuestyMonthlyFinancialsByListing (lib/
// guesty.ts) utilise money.commission, mais l'utilisateur rapporte que la
// commission affichée dans l'app est ~moitié de la vraie — ce dump sert à
// retrouver le bon champ/calcul avant de corriger.

function numOrNull(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  const searchParams = new URL(request.url).searchParams;
  const listingName = searchParams.get("listing");
  const yearParam = searchParams.get("year");
  const year = yearParam ? Number.parseInt(yearParam, 10) : NaN;
  if (!listingName) {
    return NextResponse.json(
      { error: "Paramètre 'listing' requis (nom exact du listing VRPlatform, ex: MORET A1 CV 101)." },
      { status: 400 }
    );
  }
  if (!Number.isInteger(year)) return NextResponse.json({ error: "Année invalide." }, { status: 400 });

  const allListings = await listAllVrPlatformListingsAnyStatus();
  const listing = allListings.find((l) => l.name.trim().toLowerCase() === listingName.trim().toLowerCase());
  if (!listing || !listing.uniqueRef) {
    return NextResponse.json({ error: `Listing "${listingName}" introuvable ou sans ID Guesty.` }, { status: 404 });
  }

  const allReservations = await getAllGuestyReservationsRaw();
  const matches = allReservations.filter((r) => r.listingId === listing.uniqueRef);

  const rows = matches.map((r) => {
    const money = (r.money as Record<string, unknown>) ?? {};
    const invoiceItems = Array.isArray(money.invoiceItems) ? (money.invoiceItems as Record<string, unknown>[]) : [];
    const markupTotal = invoiceItems
      .filter((it) => it.normalType === "MAR")
      .reduce((sum, it) => sum + (numOrNull(it.amount) ?? 0), 0);

    return {
      confirmationCode: r.confirmationCode,
      status: r.status,
      source: r.source,
      checkIn: r.checkIn,
      checkOut: r.checkOut,
      fareAccommodation: numOrNull(money.fareAccommodation),
      fareAccommodationAdjusted: numOrNull(money.fareAccommodationAdjusted),
      hostServiceFee: numOrNull(money.hostServiceFee),
      hostServiceFeeIncTax: numOrNull(money.hostServiceFeeIncTax),
      hostServiceFeeTax: numOrNull(money.hostServiceFeeTax),
      netIncome: numOrNull(money.netIncome),
      commission: numOrNull(money.commission),
      commissionIncTax: numOrNull(money.commissionIncTax),
      commissionTax: numOrNull(money.commissionTax),
      commissionFormula: typeof money.commissionFormula === "string" ? money.commissionFormula : null,
      ownerRevenue: numOrNull(money.ownerRevenue),
      hostPayout: numOrNull(money.hostPayout),
      totalPrice: numOrNull(money.totalPrice) ?? numOrNull(money.subTotalPrice),
      markupTotal,
    };
  });

  const inYear = rows.filter((r) => {
    if (typeof r.checkOut !== "string") return false;
    const d = new Date(r.checkOut);
    return !Number.isNaN(d.getTime()) && d.getUTCFullYear() === year;
  });

  const sum = (key: keyof (typeof rows)[number]) =>
    inYear.reduce((acc, r) => acc + (typeof r[key] === "number" ? (r[key] as number) : 0), 0);

  return NextResponse.json(
    {
      listingName: listing.name,
      guestyListingId: listing.uniqueRef,
      totalReservationsAllTime: matches.length,
      reservationsInYear: inYear.length,
      totals: {
        fareAccommodationAdjusted: sum("fareAccommodationAdjusted"),
        hostServiceFeeIncTax: sum("hostServiceFeeIncTax"),
        netIncome: sum("netIncome"),
        commission: sum("commission"),
        commissionIncTax: sum("commissionIncTax"),
        ownerRevenue: sum("ownerRevenue"),
        markupTotal: sum("markupTotal"),
      },
      reservations: inYear,
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
