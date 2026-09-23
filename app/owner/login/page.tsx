import { redirect, unstable_rethrow } from "next/navigation";
import { signIn } from "@/lib/actions";

export default async function OwnerLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;

  async function action(formData: FormData) {
    "use server";
    try {
      await signIn(formData);
    } catch (err) {
      unstable_rethrow(err);
      const message = err instanceof Error ? err.message : "Erreur de connexion.";
      redirect(`/owner/login?error=${encodeURIComponent(message)}`);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-[380px]">
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#1d1d1f] text-xl text-white shadow-[0_4px_14px_rgba(0,0,0,0.15)]">
            🏠
          </div>
          <h1 className="mt-4 text-[28px] font-semibold tracking-tight text-[#1d1d1f]">Espace propriétaire</h1>
          <p className="mt-1.5 text-[15px] text-[#6e6e73]">Connectez-vous pour consulter les revenus de vos biens.</p>
        </div>

        <form action={action} className="card mt-8 space-y-4 p-6">
          <input type="hidden" name="next" value="/owner" />
          <div>
            <label className="field-label" htmlFor="email">
              Email
            </label>
            <input id="email" name="email" type="email" required autoComplete="email" className="field-input" />
          </div>
          <div>
            <label className="field-label" htmlFor="password">
              Mot de passe
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="field-input"
            />
          </div>
          {error && <p className="text-[13px] text-red-600">{error}</p>}
          <button type="submit" className="w-full btn-primary justify-center">
            Se connecter
          </button>
        </form>
      </div>
    </div>
  );
}
