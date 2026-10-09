import { NextResponse } from "next/server";
import { getCurrentProfile, listPropertiesWithLease } from "@/lib/queries";
import { computeBailProrata } from "@/lib/bail";

export const dynamic = "force-dynamic";

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  const properties = await listPropertiesWithLease();

  const rows = properties.map((p) => {
    const prorata = computeBailProrata(p.leaseStartDate, p.leaseRentFreePeriodText, p.rentAmountEuros);
    const chargesCents = p.chargesAmountEuros != null ? Math.round(p.chargesAmountEuros * 100) : null;
    const totalCents =
      prorata.loyerProrataCents != null ? prorata.loyerProrataCents + (chargesCents ?? 0) : null;
    return {
      propertyId: p.id,
      reference: p.reference,
      leaseStartDate: p.leaseStartDate,
      franchiseText: p.leaseRentFreePeriodText,
      franchiseRecognized: prorata.franchiseRecognized,
      franchiseEndDate: prorata.franchiseEndIso,
      daysRemainingInMonth: prorata.daysRemainingInMonth,
      daysInMonth: prorata.daysInMonth,
      loyerProrataCents: prorata.loyerProrataCents,
      chargesCents,
      totalCents,
    };
  });

  return NextResponse.json({ rows });
}
