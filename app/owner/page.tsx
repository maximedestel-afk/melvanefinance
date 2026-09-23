import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listOwnerProperties } from "@/lib/queries";
import { getPortfolioMonthlyFinancials, isVrPlatformConfigured } from "@/lib/vrplatform";
import { signOutOwner } from "@/lib/actions";
import { OwnerDashboardClient } from "../OwnerDashboardClient";

export default async function OwnerPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { year: yearParam } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) redirect("/owner/login");

  const ownerProperties = await listOwnerProperties(user.email);

  if (ownerProperties.length === 0) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-[15px] text-[#6e6e73]">Aucun bien trouvé pour ce compte ({user.email}).</p>
        <form action={signOutOwner} className="mt-4">
          <button type="submit" className="btn-secondary btn-sm">
            Se déconnecter
          </button>
        </form>
      </div>
    );
  }

  const currentYear = new Date().getFullYear();
  const parsedYear = yearParam ? Number.parseInt(yearParam, 10) : currentYear;
  const year = Number.isInteger(parsedYear) ? parsedYear : currentYear;

  let results: Awaited<ReturnType<typeof getPortfolioMonthlyFinancials>> = [];
  let vrplatformError: string | null = null;
  if (isVrPlatformConfigured()) {
    try {
      results = await getPortfolioMonthlyFinancials(
        ownerProperties.map((p) => ({
          propertyId: p.id,
          reference: p.reference,
          name: p.name,
          rentType: p.rentType,
          rentAmount: null,
          commissionPercent: p.commissionPercent,
          extraVrplatformReferences: p.extraVrplatformReferences,
        })),
        year
      );
    } catch (err) {
      vrplatformError = err instanceof Error ? err.message : "Erreur VRPlatform inconnue.";
    }
  } else {
    vrplatformError = "VRPlatform n'est pas configuré sur ce déploiement.";
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-[#1d1d1f]">Mes revenus</h1>
          <p className="text-[14px] text-[#6e6e73]">Portefeuille Melvane</p>
        </div>
        <form action={signOutOwner}>
          <button type="submit" className="btn-secondary btn-sm">
            Se déconnecter
          </button>
        </form>
      </header>

      {vrplatformError ? (
        <p className="text-[13px] text-red-600">{vrplatformError}</p>
      ) : (
        <OwnerDashboardClient year={year} properties={results} />
      )}
    </div>
  );
}
