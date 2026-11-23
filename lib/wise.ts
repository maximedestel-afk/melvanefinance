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

interface WiseRawActivity {
  id: string;
  type: string;
  resource: { type: string; id: string };
  title: string;
  description: string;
  primaryAmount: string;
  status: string;
  createdOn: string;
  updatedOn: string;
}

interface WiseActivitiesResponse {
  cursor: string | null;
  activities: WiseRawActivity[];
}

function stripHtmlTags(value: string): string {
  return value.replace(/<\/?[a-z][^>]*>/gi, "").trim();
}

/** Parse le champ primaryAmount du flux /activities — une chaîne du type
 * "25.94 EUR" (débit, carte) ou "<positive>+ 5,224.96 EUR</positive>"
 * (crédit, viré explicitement en positif par Wise). Hypothèse déduite des
 * données observées en direct (confirmée sur des paiements carte et des
 * virements entrants) : seul le crédit est marqué par le tag <positive>/un
 * "+" explicite — tout le reste (pas de tag, pas de "-") est traité comme un
 * débit. Pas encore vérifié sur un virement SORTANT réel — à confirmer si
 * un montant ressort avec le mauvais signe. */
function parseWiseActivityAmount(raw: string): { amount: number; currency: string } | null {
  const isCredit = /<positive>/i.test(raw) || /^\s*\+/.test(raw);
  const isExplicitDebit = /<negative>/i.test(raw) || /^\s*-/.test(stripHtmlTags(raw));
  const stripped = stripHtmlTags(raw).replace(/^[+-]\s*/, "");
  const m = /^([\d,]+(?:\.\d+)?)\s*([A-Z]{3})$/.exec(stripped);
  if (!m) return null;
  const value = Number.parseFloat(m[1].replace(/,/g, ""));
  const sign = isCredit ? 1 : isExplicitDebit ? -1 : -1;
  return { amount: sign * value, currency: m[2] };
}

export interface WiseActivityRow {
  /** YYYY-MM-DD */
  date: string;
  /** Signé, format décimal simple ("-25.94", "5224.96") — même format que
   * la colonne "Amount" d'un export CSV Wise, pour rester compatible avec
   * BankStatementCsvTable.tsx. */
  amount: string;
  currency: string;
  description: string;
  /** resource.id (ID de transfert/transaction carte) — sert de "TransferWise
   * ID" (Bill ID par défaut d'une ligne de dépense). */
  wiseId: string;
  type: string;
}

/** Historique d'activité d'un profil (transferts, conversions, paiements
 * carte, frais...) sur une période, normalisé — mélange TOUTES les
 * sous-réserves du profil (pas de filtre par compte/devise possible sur cet
 * endpoint, voir le commentaire en tête de fichier). PAS l'endpoint
 * balance-statement (protégé par SCA hors US/AU/NZ/SG/CA/MY, donc
 * inutilisable pour un sync serveur sans interaction utilisateur
 * récurrente). Une seule page (jusqu'à `size` résultats, pas de suivi du
 * curseur) — suffisant pour un usage "relevé récent", pas pour un historique
 * complet. */
export async function getWiseActivityRows(profileId: number, sinceIso: string, untilIso: string, size = 200): Promise<WiseActivityRow[]> {
  const res = await wiseFetch<WiseActivitiesResponse>(`/v1/profiles/${profileId}/activities`, {
    since: sinceIso,
    until: untilIso,
    size: String(size),
  });
  const rows: WiseActivityRow[] = [];
  for (const activity of res.activities) {
    const parsed = parseWiseActivityAmount(activity.primaryAmount);
    if (!parsed) continue;
    rows.push({
      date: activity.createdOn.slice(0, 10),
      amount: parsed.amount.toFixed(2),
      currency: parsed.currency,
      description: stripHtmlTags(activity.title),
      wiseId: activity.resource.id,
      type: activity.type,
    });
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}
