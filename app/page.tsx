import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile, listPropertiesForFinance } from "@/lib/queries";
import { signOut } from "@/lib/actions";
import { DashboardClient } from "./DashboardClient";
import { ProvisionOwnersButton } from "./ProvisionOwnersButton";

export default async function DashboardPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  if (profile.role !== "admin") {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-[15px] text-[#6e6e73]">Cette application est réservée aux administrateurs.</p>
      </div>
    );
  }

  const properties = await listPropertiesForFinance();

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-[#1d1d1f]">Analyse financière</h1>
          <p className="text-[14px] text-[#6e6e73]">Portefeuille M.G.B — données VRPlatform</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/owner" className="btn-secondary btn-sm">
            Espace propriétaire
          </Link>
          <ProvisionOwnersButton />
          <form action={signOut}>
            <button type="submit" className="btn-secondary btn-sm">
              Se déconnecter
            </button>
          </form>
        </div>
      </header>

      <DashboardClient
        properties={properties.map((p) => ({
          id: p.id,
          reference: p.reference,
          name: p.name,
          tags: p.tags,
          rentType: p.rentType,
          cleaningProviderName: p.cleaningProviderName,
          bonusFdPercent: p.bonusFdPercent,
        }))}
      />
    </div>
  );
}
