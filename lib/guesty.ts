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

export type GuestyCalendarDayStatus = "available" | "occupied" | "blocked";

export interface GuestyCalendarDay {
  date: string;
  status: GuestyCalendarDayStatus;
  guestName: string | null;
  confirmationCode: string | null;
  source: string | null;
  checkIn: string | null;
  checkOut: string | null;
  /** Prix affiché par Guesty pour cette nuit (tarif dynamique du calendrier,
   * pas le prix effectivement facturé pour une réservation existante). */
  priceCents: number | null;
  currency: string | null;
  /** Nombre de nuits minimum pour un séjour démarrant ce jour-là. */
  minNights: number | null;
  /** Raison du blocage manuel, si renseignée côté PMS. */
  note: string | null;
}

interface RawCalendarBlockRef {
  reservationId?: string;
  reservation?: {
    confirmationCode?: string;
    source?: string;
    guest?: { fullName?: string };
    checkIn?: string;
    checkOut?: string;
  };
}

interface RawCalendarDay {
  date: string;
  status: string;
  blockRefs: RawCalendarBlockRef[];
  price?: number | null;
  currency?: string | null;
  minNights?: number | null;
  note?: string | null;
}

interface RawCalendarResponse {
  data: { days: RawCalendarDay[] };
}

/** Calendrier jour par jour d'un listing Guesty (disponible / occupé / bloqué
 * manuellement), utilisé par la vue calendrier de l'espace propriétaire.
 * Endpoint /v1/availability-pricing/api/calendar/listings/{id} — les
 * endpoints /listings/:id/calendar historiques sont dépréciés depuis 2022.
 * Un jour est "occupé" s'il référence une réservation, "bloqué" si son statut
 * n'est ni "available" ni lié à une réservation (blocage manuel côté PMS). */
export async function getGuestyCalendarMonth(
  guestyListingId: string,
  startDate: string,
  endDate: string
): Promise<GuestyCalendarDay[]> {
  const url = new URL(`https://open-api.guesty.com/v1/availability-pricing/api/calendar/listings/${guestyListingId}`);
  url.searchParams.set("startDate", startDate);
  url.searchParams.set("endDate", endDate);
  const res = await guestyFetch<RawCalendarResponse>(url);

  return res.data.days.map((day) => {
    const priceCents = typeof day.price === "number" ? Math.round(day.price * 100) : null;
    const currency = day.currency ?? null;
    const minNights = typeof day.minNights === "number" ? day.minNights : null;
    const note = day.note ?? null;

    const reservationBlock = day.blockRefs.find((b) => b.reservationId && b.reservation);
    if (reservationBlock?.reservation) {
      const r = reservationBlock.reservation;
      return {
        date: day.date,
        status: "occupied",
        guestName: r.guest?.fullName ?? null,
        confirmationCode: r.confirmationCode ?? null,
        source: r.source ?? null,
        checkIn: r.checkIn ?? null,
        checkOut: r.checkOut ?? null,
        priceCents,
        currency,
        minNights,
        note,
      };
    }
    return {
      date: day.date,
      status: day.status === "available" ? "available" : "blocked",
      guestName: null,
      confirmationCode: null,
      source: null,
      checkIn: null,
      checkOut: null,
      priceCents,
      currency,
      minNights,
      note,
    };
  });
}

// --- TEMPORAIRE : diagnostic réservations Guesty vs VRPlatform (à retirer
// après usage, voir app/api/admin/zeev-reservations-check/route.ts). ---

export interface GuestyReservationSummary {
  _id: string;
  listingId: string;
  status: string | null;
  checkIn: string | null;
  checkOut: string | null;
  confirmationCode: string | null;
  guestName: string | null;
  source: string | null;
}

interface GuestyReservationsPage {
  results: Record<string, unknown>[];
  count: number;
}

/** L'API Guesty /v1/reservations ignore silencieusement listingId= et
 * filters= côté serveur (constaté empiriquement) : il faut paginer tout le
 * compte et filtrer côté client. */
export async function getAllGuestyReservations(): Promise<GuestyReservationSummary[]> {
  const limit = 100;
  let skip = 0;
  let total = Infinity;
  const all: GuestyReservationSummary[] = [];
  while (skip < total) {
    const url = new URL(`${API_BASE_URL}/reservations`);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("skip", String(skip));
    const page = await guestyFetch<GuestyReservationsPage>(url);
    total = page.count;
    for (const r of page.results) {
      const guest = r.guest as Record<string, unknown> | undefined;
      all.push({
        _id: String(r._id),
        listingId: String(r.listingId ?? ""),
        status: (r.status as string) ?? null,
        checkIn: (r.checkIn as string) ?? null,
        checkOut: (r.checkOut as string) ?? null,
        confirmationCode: (r.confirmationCode as string) ?? null,
        guestName: (guest?.fullName as string) ?? null,
        source: (r.source as string) ?? null,
      });
    }
    skip += limit;
  }
  return all;
}

export interface GuestyMonthlyFinanceCents {
  month: number;
  netAccommodationFareCents: number;
  channelFeesCents: number;
  netRevenueCents: number;
  commissionCents: number;
}

/** Rents/Channel fees/Net Revenue/Commission mensuels calculés directement
 * depuis les réservations Guesty, par listing — pour les biens dont la
 * facturation ne passe pas par VRPlatform (ex: Moret, dont les listings
 * VRPlatform sont inactifs). Chaque appartement Moret est son propre bien
 * côté Supabase (référence = nom du listing VRPlatform/Guesty), donc ce
 * calcul doit rester par listing et ne jamais agréger plusieurs
 * appartements ensemble. Mapping confirmé sur de vraies réservations Guesty
 * (voir app/api/admin/guesty-moret-fields-check) :
 *   - Rents           = money.fareAccommodationAdjusted ("Net Accommodation Fare")
 *   - Channel fees    = money.hostServiceFeeIncTax ("Channel Commission Incl Tax")
 *   - Net Revenue     = Rents − Channel fees (= money.netIncome, vérifié identique)
 *   - Commission      = money.commission (commission de gestion Melvane)
 * N'inclut ni city tax, ni frais de transfert, ni ménage — hors périmètre.
 * Attribution par mois de check-out (même base que MonthlyFinance.rentsCents
 * côté VRPlatform), sur les réservations valides uniquement — pas seulement
 * "confirmed" : Guesty fait passer une réservation à "checked_in" puis
 * "checked_out" une fois le séjour effectué (confirmé dans ce compte même,
 * cf. integration.limitations.availableStatuses:
 * ["checked_in","checked_out","canceled"]) — ne garder que "confirmed"
 * excluait silencieusement tous les séjours déjà passés, ~moitié du
 * chiffre réel. */
const GUESTY_REVENUE_STATUSES = new Set(["confirmed", "checked_in", "checked_out"]);

export async function getGuestyMonthlyFinancialsByListing(
  guestyListingIds: string[],
  year: number,
  months?: number[]
): Promise<Map<string, GuestyMonthlyFinanceCents[]>> {
  const result = new Map<string, GuestyMonthlyFinanceCents[]>();
  const listingIdSet = new Set(guestyListingIds);
  for (const id of listingIdSet) {
    result.set(
      id,
      Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        netAccommodationFareCents: 0,
        channelFeesCents: 0,
        netRevenueCents: 0,
        commissionCents: 0,
      }))
    );
  }
  if (listingIdSet.size === 0) return result;

  // Ne couvrir que les mois réellement affichés : sur tout le compte (pas
  // seulement Moret), chercher l'année complète paginait des centaines de
  // réservations et dépassait le timeout de la fonction serverless — la
  // plupart des consultations ne portent que sur 1-2 mois.
  const requestedMonths = months && months.length > 0 ? months : Array.from({ length: 12 }, (_, i) => i + 1);
  const minMonth = Math.min(...requestedMonths);
  const maxMonth = Math.max(...requestedMonths);
  const lastDayOfMaxMonth = new Date(Date.UTC(year, maxMonth, 0)).getUTCDate();
  const checkOutRange = {
    from: `${year}-${String(minMonth).padStart(2, "0")}-01`,
    to: `${year}-${String(maxMonth).padStart(2, "0")}-${String(lastDayOfMaxMonth).padStart(2, "0")}`,
  };

  const reservations = await getAllGuestyReservationsRaw(checkOutRange);
  for (const r of reservations) {
    if (typeof r.status !== "string" || !GUESTY_REVENUE_STATUSES.has(r.status)) continue;
    const listingId = typeof r.listingId === "string" ? r.listingId : null;
    if (!listingId) continue;
    const months = result.get(listingId);
    if (!months) continue;
    const checkOut = typeof r.checkOut === "string" ? r.checkOut : null;
    if (!checkOut) continue;
    const checkOutDate = new Date(checkOut);
    if (Number.isNaN(checkOutDate.getTime()) || checkOutDate.getUTCFullYear() !== year) continue;
    const monthIndex = checkOutDate.getUTCMonth();

    const money = r.money as Record<string, unknown> | undefined;
    const netAccommodationFare = typeof money?.fareAccommodationAdjusted === "number" ? money.fareAccommodationAdjusted : 0;
    const channelFees = typeof money?.hostServiceFeeIncTax === "number" ? money.hostServiceFeeIncTax : 0;
    const commission = typeof money?.commission === "number" ? money.commission : 0;

    months[monthIndex].netAccommodationFareCents += Math.round(netAccommodationFare * 100);
    months[monthIndex].channelFeesCents += Math.round(channelFees * 100);
    months[monthIndex].commissionCents += Math.round(commission * 100);
  }
  for (const months of result.values()) {
    for (const m of months) m.netRevenueCents = m.netAccommodationFareCents - m.channelFeesCents;
  }
  return result;
}

/** Variante brute de getAllGuestyReservations qui renvoie les objets Guesty
 * complets (dont `money`), sans les réduire à GuestyReservationSummary — pour
 * inspecter les champs financiers réels exposés par l'API avant de les
 * mapper. `fields` est explicitement demandé pour forcer l'inclusion de
 * `money` (plusieurs endpoints Guesty omettent les sous-objets lourds par
 * défaut si on ne les demande pas).
 *
 * `checkOutRange` borne la requête sur le champ `checkOut` via le paramètre
 * `filters` (tableau JSON `[{field, operator, value}]`) — c'est le SEUL
 * format de filtre que Guesty applique réellement côté serveur ; un simple
 * query param (`checkInDateFrom=`, `fromDate=`, etc.) est silencieusement
 * ignoré, confirmé empiriquement (voir
 * app/api/admin/guesty-date-param-check). Plus important : SANS aucun
 * filtre, l'API ne renvoie que les réservations à venir à partir
 * d'aujourd'hui — toute réservation passée est absente des résultats, même
 * en paginant tout le compte. Toujours fournir `checkOutRange` pour une
 * période couvrant du passé (sinon les réservations déjà terminées
 * manquent silencieusement, confirmé sur un export Guesty réel : ~la moitié
 * du chiffre d'affaires d'un mois en cours disparaissait). */
export async function getAllGuestyReservationsRaw(checkOutRange?: { from: string; to: string }): Promise<Record<string, unknown>[]> {
  const limit = 100;
  let skip = 0;
  let total = Infinity;
  const all: Record<string, unknown>[] = [];
  while (skip < total) {
    const url = new URL(`${API_BASE_URL}/reservations`);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("skip", String(skip));
    url.searchParams.set("fields", "listingId status checkIn checkOut confirmationCode guest source money");
    if (checkOutRange) {
      url.searchParams.set(
        "filters",
        JSON.stringify([
          { field: "checkOut", operator: "$gte", value: checkOutRange.from },
          { field: "checkOut", operator: "$lte", value: checkOutRange.to },
        ])
      );
    }
    const page = await guestyFetch<GuestyReservationsPage>(url);
    total = page.count;
    all.push(...page.results);
    skip += limit;
  }
  return all;
}
