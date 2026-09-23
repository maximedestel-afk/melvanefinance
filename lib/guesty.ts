// Intégration Guesty (Open API) — pour des données sur les biens que
// VRPlatform n'expose pas (ex: prix du ménage, équipements, chambres...).
// Authentification OAuth2 client_credentials, jamais depuis le client.
//
// Guesty limite chaque client_id à 5 tokens actifs : un token par appel
// (ou par cold start serverless) épuiserait vite ce quota. Le token est
// donc mis en cache dans Supabase (table `guesty_oauth_cache`, accédée en
// service_role) — partagé entre toutes les instances Vercel — avec un
// cache mémoire en plus pour éviter un aller-retour DB à chaque appel dans
// une même instance déjà chaude.

import { createAdminClient } from "./supabase/admin";

const API_BASE_URL = "https://open-api.guesty.com/v1";
const TOKEN_URL = "https://open-api.guesty.com/oauth2/token";
const TOKEN_CACHE_ROW_ID = 1;

let memoryCachedToken: { value: string; expiresAt: number } | null = null;

export function isGuestyConfigured(): boolean {
  return !!process.env.GUESTY_CLIENT_ID && !!process.env.GUESTY_CLIENT_SECRET;
}

/** Traite `items` avec au plus `concurrency` appels Guesty en vol à la
 * fois — appeler l'API en parallèle pour tout le portefeuille dépasse vite
 * les limites de débit de Guesty et fait échouer silencieusement une
 * partie des requêtes. */
export async function mapWithGuestyConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency = 2
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await fn(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function fetchNewGuestyToken(): Promise<{ value: string; expiresAt: number }> {
  const clientId = process.env.GUESTY_CLIENT_ID;
  const clientSecret = process.env.GUESTY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Guesty n'est pas configuré (GUESTY_CLIENT_ID / GUESTY_CLIENT_SECRET manquants).");
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "open-api",
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Guesty a refusé l'authentification (${response.status}).`);
  }
  const data = (await response.json()) as { access_token: string; expires_in: number };
  // Marge de 5 min avant expiration pour éviter d'utiliser un token tout juste périmé.
  return { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 300) * 1000 };
}

async function getGuestyToken(): Promise<string> {
  if (memoryCachedToken && memoryCachedToken.expiresAt > Date.now()) return memoryCachedToken.value;

  const supabase = createAdminClient();
  const { data: cached } = await supabase
    .from("guesty_oauth_cache")
    .select("access_token, expires_at")
    .eq("id", TOKEN_CACHE_ROW_ID)
    .maybeSingle();

  if (cached && new Date(cached.expires_at).getTime() > Date.now()) {
    memoryCachedToken = { value: cached.access_token, expiresAt: new Date(cached.expires_at).getTime() };
    return cached.access_token;
  }

  const token = await fetchNewGuestyToken();
  memoryCachedToken = token;
  await supabase.from("guesty_oauth_cache").upsert({
    id: TOKEN_CACHE_ROW_ID,
    access_token: token.value,
    expires_at: new Date(token.expiresAt).toISOString(),
  });
  return token.value;
}

/** Appel Guesty authentifié avec retry en cas de 429/502/503 — un 429 isolé
 * au milieu d'un lot de requêtes (même limité en concurrence) ne doit pas
 * se traduire par une donnée manquante silencieuse. */
async function guestyFetch<T>(url: string | URL): Promise<T> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const token = await getGuestyToken();
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (response.ok) return response.json() as Promise<T>;

    const isRetryable = response.status === 429 || response.status === 502 || response.status === 503;
    if (!isRetryable || attempt === maxAttempts) {
      throw new Error(`Guesty a répondu ${response.status} sur ${url}.`);
    }
    const retryAfterSeconds = Number(response.headers.get("Retry-After"));
    const delayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : attempt * 800;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`Guesty : échec après ${maxAttempts} tentatives sur ${url}.`);
}

export interface GuestyAddress {
  full: string | null;
  lng: number | null;
  lat: number | null;
  street: string | null;
  city: string | null;
  country: string | null;
}

export interface GuestyPrices {
  basePrice: number | null;
  weekendBasePrice: number | null;
  extraPersonFee: number | null;
  guestsIncludedInRegularFee: number | null;
  securityDepositFee: number | null;
  cleaningFee: number | null;
  currency: string | null;
}

export interface GuestyListing {
  _id: string;
  title: string | null;
  nickname: string | null;
  tags: string[];
  isListed: boolean;
  active: boolean;
  propertyType: string | null;
  roomType: string | null;
  bedType: string | null;
  accommodates: number | null;
  bedrooms: number | null;
  areaSquareFeet: number | null;
  address: GuestyAddress | null;
  timezone: string | null;
  defaultCheckInTime: string | null;
  defaultCheckOutTime: string | null;
  amenities: string[];
  amenitiesNotIncluded: string[];
  terms: { minNights: number | null; maxNights: number | null; cancellation: string | null } | null;
  prices: GuestyPrices | null;
  cleaning: { defaultCleaningTime: string | null; instructions: string | null } | null;
  cleaningStatus: { value: string | null; updatedAt: string | null } | null;
  customFields: unknown[];
  bathrooms: number | null;
  beds: number | null;
  type: string | null;
  contactPhone: string | null;
  owners: string[];
  propertyLicenseNumber: string | null;
  /** Tout autre champ Guesty non listé explicitement ci-dessus reste
   * accessible (ex: financials, pms, integrations, license...) — l'objet
   * listing complet est bien plus large que ce fichier n'en type. */
  [key: string]: unknown;
}

/** Objet listing complet d'un bien Guesty. Le bien est identifié par son ID
 * Guesty natif — pour un listing VRPlatform, c'est son champ `uniqueRef`
 * (VRPlatform passe par Guesty comme PMS sous-jacente). Passer `fields`
 * pour ne récupérer que certains champs (ex: ["title", "prices"]) et
 * réduire la charge de réponse. */
export async function getGuestyListing(guestyListingId: string, fields?: string[]): Promise<GuestyListing> {
  const url = new URL(`${API_BASE_URL}/listings/${guestyListingId}`);
  if (fields && fields.length > 0) url.searchParams.set("fields", fields.join(" "));
  return guestyFetch<GuestyListing>(url);
}

export interface GuestyCustomFieldValue {
  fieldId: string;
  key: string;
  displayName: string;
  type: string;
  value: string;
}

/** Valeurs des custom fields configurés sur un bien Guesty (nom et clé
 * propres à chaque compte). */
export async function getPropertyCustomFieldValues(guestyPropertyId: string): Promise<GuestyCustomFieldValue[]> {
  const data = await guestyFetch<{ propertyId: string; customFields: GuestyCustomFieldValue[] }>(
    `${API_BASE_URL}/properties-api/custom-fields/${guestyPropertyId}`
  );
  return data.customFields;
}

const CLEANING_FIELD_KEY = "cleaning_rate";

export interface GuestyCleaningPrices {
  /** Prix configuré comme custom field (clé `cleaning_rate`) — null si absent. */
  customField: number | null;
  /** Prix du champ standard Guesty prices.cleaningFee. */
  standard: number | null;
}

/** Les deux prix de ménage d'un bien Guesty : le custom field `cleaning_rate`
 * et le champ standard prices.cleaningFee — pour comparer les deux, ils
 * peuvent diverger. */
export async function getGuestyCleaningPrices(guestyListingId: string): Promise<GuestyCleaningPrices> {
  const [listing, customFields] = await Promise.all([
    getGuestyListing(guestyListingId),
    getPropertyCustomFieldValues(guestyListingId),
  ]);

  const field = customFields.find((f) => f.key === CLEANING_FIELD_KEY);
  // Guesty renvoie un nombre JS brut pour les champs de type "number", malgré
  // le type "string" annoncé dans leur schéma — Number() gère les deux cas.
  const customFieldValue = field && field.value !== "" && field.value != null ? Number(field.value) : NaN;

  return {
    customField: Number.isFinite(customFieldValue) ? customFieldValue : null,
    standard: listing.prices?.cleaningFee ?? null,
  };
}
