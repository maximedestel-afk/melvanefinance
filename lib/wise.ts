// Intégration Wise (Business) en lecture seule — doit à terme remplacer
// l'import CSV manuel du Relevé Bancaire (voir BankStatementCsvTable.tsx)
// par les vraies transactions Wise en direct. Token API généré côté Wise
// (Paramètres > Intégrations personnalisées > API tokens), stocké dans
// WISE_API_KEY. Doc : https://docs.wise.com/api-docs/api-reference.

const API_BASE_URL = "https://api.wise.com";

export function isWiseConfigured(): boolean {
  return !!process.env.WISE_API_KEY;
}

async function wiseFetch<T>(path: string, query?: Record<string, string>): Promise<T> {
  const apiKey = process.env.WISE_API_KEY;
  if (!apiKey) throw new Error("Wise n'est pas configuré (WISE_API_KEY manquant).");

  const url = new URL(path, API_BASE_URL);
  if (query) for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Wise a répondu ${response.status} sur ${path}${body ? ` — ${body.slice(0, 300)}` : ""}`);
  }
  return response.json() as Promise<T>;
}

export interface WiseProfile {
  id: number;
  type: "personal" | "business";
  details?: { name?: string } | null;
}

/** Profils accessibles au token — un token Business donne en principe accès
 * au(x) profil(s) business du compte. Pas de SCA requis pour cet endpoint
 * (confirmé par la doc Wise). */
export async function getWiseProfiles(): Promise<WiseProfile[]> {
  return wiseFetch<WiseProfile[]>("/v1/profiles");
}

export interface WiseBalance {
  id: number;
  currency: string;
  amount: { value: number; currency: string };
  name: string | null;
  type: string;
}

/** Soldes (comptes multi-devises) d'un profil — types STANDARD (comptes
 * courants par devise) et SAVINGS (cagnottes). */
export async function getWiseBalances(profileId: number): Promise<WiseBalance[]> {
  return wiseFetch<WiseBalance[]>(`/v4/profiles/${profileId}/balances`, { types: "STANDARD,SAVINGS" });
}

/** Historique d'activité d'un profil (transferts, conversions, paiements
 * carte, frais...) sur une période — PAS l'endpoint balance-statement
 * (protégé par SCA hors US/AU/NZ/SG/CA/MY, donc inutilisable pour un sync
 * serveur sans interaction utilisateur récurrente). Structure brute non
 * encore typée : voir la route de diagnostic wise-check pour l'inspecter en
 * direct avant de construire le mapping définitif. */
export async function getWiseActivities(
  profileId: number,
  sinceIso: string,
  untilIso: string,
  size = 100
): Promise<Record<string, unknown>> {
  return wiseFetch<Record<string, unknown>>(`/v1/profiles/${profileId}/activities`, {
    since: sinceIso,
    until: untilIso,
    size: String(size),
  });
}
