// Intégration Wise (Business) en lecture seule — doit à terme remplacer
// l'import CSV manuel du Relevé Bancaire (voir BankStatementCsvTable.tsx)
// par les vraies transactions Wise en direct. Token API généré côté Wise
// (Paramètres > Intégrations personnalisées > API tokens), stocké dans
// WISE_API_KEY. Doc : https://docs.wise.com/api-docs/api-reference.

import { createSign } from "crypto";

const API_BASE_URL = "https://api.wise.com";

export function isWiseConfigured(): boolean {
  return !!process.env.WISE_API_KEY;
}

export function isWiseScaConfigured(): boolean {
  return !!process.env.WISE_SCA_PRIVATE_KEY;
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
    throw new Error(
      `Wise a répondu ${response.status} sur ${url.pathname}${url.search} — ${body.slice(0, 500) || "(réponse sans corps)"}`
    );
  }
  return response.json() as Promise<T>;
}

/** Signe un one-time-token (OTT) SCA avec la clé privée RSA enregistrée côté
 * Wise (clé publique associée au token API, voir Paramètres > API tokens >
 * Strong Customer Authentication) — SHA256withRSA, base64. Flux officiel
 * TransferWise pour un token Personal/Business (pas de ré-approbation
 * interactive type SMS/push, juste une signature cryptographique côté
 * serveur). Voir https://github.com/transferwise/digital-signatures-examples. */
function signOneTimeToken(ott: string): string {
  const privateKey = process.env.WISE_SCA_PRIVATE_KEY;
  if (!privateKey) throw new Error("Wise SCA non configuré (WISE_SCA_PRIVATE_KEY manquant).");
  const signer = createSign("RSA-SHA256");
  signer.update(ott);
  signer.end();
  // Accepte la clé avec de vrais retours à la ligne (valeur multi-ligne
  // Vercel) ou avec des "\n" littéraires échappés (si collée sur une seule
  // ligne) — les deux formats sont courants selon comment la variable a été
  // saisie.
  return signer.sign(privateKey.replace(/\\n/g, "\n"), "base64");
}

/** Comme wiseFetch, mais relance automatiquement la requête avec la
 * signature SCA si Wise répond 403 avec un one-time-token à signer
 * (x-2fa-approval) — nécessaire pour l'endpoint balance-statement, protégé
 * par SCA hors US/AU/NZ/SG/CA/MY. */
async function wiseFetchWithSca<T>(path: string, query?: Record<string, string>): Promise<T> {
  const apiKey = process.env.WISE_API_KEY;
  if (!apiKey) throw new Error("Wise n'est pas configuré (WISE_API_KEY manquant).");

  const url = new URL(path, API_BASE_URL);
  if (query) for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

  const doFetch = (extraHeaders?: Record<string, string>) =>
    fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, ...extraHeaders }, cache: "no-store" });

  let response = await doFetch();
  if (response.status === 403) {
    const ott = response.headers.get("x-2fa-approval");
    if (!ott) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Wise a répondu 403 sur ${url.pathname}${url.search} sans one-time-token SCA — ${body.slice(0, 500) || "(réponse sans corps)"}`
      );
    }
    const signature = signOneTimeToken(ott);
    response = await doFetch({ "x-2fa-approval": ott, "X-Signature": signature });
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Wise a répondu ${response.status} sur ${url.pathname}${url.search} — ${body.slice(0, 500) || "(réponse sans corps)"}`
    );
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

// size=200 renvoie un 400 (sans corps) — confirmé en direct via la route de
// diagnostic wise-activities-debug ; size=10 passe. Valeur max réelle non
// connue avec certitude, 50 reste prudent sous ce seuil.
const ACTIVITIES_PAGE_SIZE = 50;
const ACTIVITIES_MAX_PAGES = 20;

/** Historique d'activité d'un profil (transferts, conversions, paiements
 * carte, frais...) sur une période, normalisé, en suivant la pagination par
 * curseur (nextCursor) tant qu'une page est pleine — mélange TOUTES les
 * sous-réserves du profil (pas de filtre par compte/devise possible sur cet
 * endpoint, voir le commentaire en tête de fichier). Pour un relevé séparé
 * par compte, voir getWiseBalanceStatementRows (endpoint balance-statement,
 * protégé par SCA hors US/AU/NZ/SG/CA/MY — géré via signature RSA, voir
 * wiseFetchWithSca). */
export async function getWiseActivityRows(profileId: number, sinceIso: string, untilIso: string): Promise<WiseActivityRow[]> {
  const rows: WiseActivityRow[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < ACTIVITIES_MAX_PAGES; page++) {
    const query: Record<string, string> = { since: sinceIso, until: untilIso, size: String(ACTIVITIES_PAGE_SIZE) };
    if (cursor) query.nextCursor = cursor;
    let res: WiseActivitiesResponse;
    try {
      res = await wiseFetch<WiseActivitiesResponse>(`/v1/profiles/${profileId}/activities`, query);
    } catch (err) {
      // Au-delà de la première page : dégradation silencieuse (nom exact du
      // paramètre de pagination non garanti) — on garde ce qui a déjà été
      // collecté plutôt que de tout perdre. La première page doit réussir.
      if (page === 0) throw err;
      break;
    }
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
    if (res.activities.length < ACTIVITIES_PAGE_SIZE || !res.cursor) break;
    cursor = res.cursor;
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

/** Relevé officiel d'un compte (balance) Wise sur une période — seul
 * endpoint réellement filtré par compte (l'endpoint /activities mélange
 * tout, voir plus haut), mais protégé par SCA hors US/AU/NZ/SG/CA/MY, géré
 * via wiseFetchWithSca (signature RSA, pas d'approbation interactive).
 * intervalStart/intervalEnd en ISO 8601, écart max 469 jours (limite
 * documentée Wise). type=FLAT pour une ligne par écriture (COMPACT regroupe
 * certaines lignes). Forme brute de la réponse pas encore stabilisée — voir
 * la route de diagnostic wise-statement-check avant de construire un
 * mapping définitif vers WiseActivityRow. */
export async function getWiseBalanceStatementRaw(
  profileId: number,
  balanceId: number,
  currency: string,
  intervalStartIso: string,
  intervalEndIso: string
): Promise<Record<string, unknown>> {
  return wiseFetchWithSca<Record<string, unknown>>(
    `/v1/profiles/${profileId}/balance-statements/${balanceId}/statement.json`,
    { currency, intervalStart: intervalStartIso, intervalEnd: intervalEndIso, type: "FLAT" }
  );
}
