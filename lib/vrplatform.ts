// Intégration VRPlatform pour l'analyse financière du portefeuille — reprend
// le même calcul que l'onglet Finances de M.G.B (Rents, Channel Fees, Net
// Commissionable Revenue, taux de remplissage), étendu pour travailler sur
// tous les biens et plusieurs années à la fois. Appelle directement l'API
// VRPlatform (https://api.vrplatform.app) avec une clé d'API "Team or
// partner backend" (x-api-key + x-team-id) — jamais depuis le client.

const API_BASE_URL = "https://api.vrplatform.app";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function isVrPlatformConfigured(): boolean {
  return !!process.env.VRPLATFORM_API_KEY && !!process.env.VRPLATFORM_TEAM_ID;
}

async function vrPlatformFetch<T>(path: string, query: Record<string, string>): Promise<T> {
  const apiKey = process.env.VRPLATFORM_API_KEY;
  const teamId = process.env.VRPLATFORM_TEAM_ID;
  if (!apiKey || !teamId) {
    throw new Error("VRPlatform n'est pas configuré (VRPLATFORM_API_KEY / VRPLATFORM_TEAM_ID manquants).");
  }

  const url = new URL(path, API_BASE_URL);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

  const response = await fetch(url, {
    headers: { "x-api-key": apiKey, "x-team-id": teamId },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`VRPlatform a répondu ${response.status} sur ${path}.`);
  }
  return response.json() as Promise<T>;
}

interface VrPlatformListingsResponse {
  data: { id: string; name: string | null; title: string | null; uniqueRef: string | null }[];
  pagination: { page: number; totalPage: number };
}

interface VrPlatformListingOption {
  id: string;
  name: string;
  /** ID Guesty natif du listing (VRPlatform passe par Guesty comme PMS
   * sous-jacente) — utilisé pour interroger l'API Guesty directement. */
  uniqueRef: string | null;
}

/** Tous les listings actifs de l'équipe, chargés une seule fois par requête
 * et réutilisés pour résoudre les références de tous les biens du
 * portefeuille — évite un aller-retour /listings par bien. */
async function listVrPlatformListings(): Promise<VrPlatformListingOption[]> {
  const options: VrPlatformListingOption[] = [];
  let page = 1;
  for (;;) {
    const res = await vrPlatformFetch<VrPlatformListingsResponse>("/listings", {
      status: "active",
      limit: "250",
      page: String(page),
    });
    for (const listing of res.data) {
      options.push({
        id: listing.id,
        name: listing.title || listing.name || listing.id,
        uniqueRef: listing.uniqueRef,
      });
    }
    if (page >= res.pagination.totalPage) break;
    page++;
  }
  return options;
}

interface VrPlatformReservationLine {
  type: string | null;
  amount: number | null;
}

interface VrPlatformReservation {
  checkIn: string | null;
  checkOut: string | null;
  status: "booked" | "canceled" | "inactive";
  lines: VrPlatformReservationLine[] | null;
}

interface VrPlatformReservationsResponse {
  data: VrPlatformReservation[];
  pagination: { page: number; totalPage: number };
}

interface VrPlatformLineMappingsResponse {
  data: { type: string; account: { name: string } | null }[];
  pagination: { page: number; totalPage: number };
}

const RENTS_ACCOUNT = "Rents";
const CHANNEL_COMMISSION_ACCOUNTS = new Set(["Channel Commissions - Airbnb", "Channel Commissions (Reference Account)"]);
const CITY_TAX_ACCOUNT = "City Taxes Revenue";

/** Table "type de ligne de réservation" → nom du compte comptable,
 * configurée côté VRPlatform (Réglages > Reservation Line Mappings). */
async function getReservationLineAccountMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let page = 1;
  for (;;) {
    const res = await vrPlatformFetch<VrPlatformLineMappingsResponse>("/reservations/line-mappings", {
      limit: "250",
      page: String(page),
    });
    for (const mapping of res.data) {
      if (mapping.account) map.set(mapping.type, mapping.account.name);
    }
    if (page >= res.pagination.totalPage) break;
    page++;
  }
  return map;
}

function classifyReservationLines(
  lines: VrPlatformReservationLine[] | null,
  accountByLineType: Map<string, string>
): { rentsCents: number; channelFeesCents: number; cityTaxCents: number } {
  let rentsCents = 0;
  let channelFeesCents = 0;
  let cityTaxCents = 0;
  if (!lines) return { rentsCents, channelFeesCents, cityTaxCents };
  for (const line of lines) {
    if (!line.type) continue;
    const account = accountByLineType.get(line.type);
    if (account === RENTS_ACCOUNT) rentsCents += line.amount ?? 0;
    else if (account && CHANNEL_COMMISSION_ACCOUNTS.has(account)) channelFeesCents += Math.abs(line.amount ?? 0);
    else if (account === CITY_TAX_ACCOUNT) cityTaxCents += Math.abs(line.amount ?? 0);
  }
  return { rentsCents, channelFeesCents, cityTaxCents };
}

export interface MonthlyFinance {
  /** 1 (janvier) à 12 (décembre). */
  month: number;
  rentsCents: number;
  channelFeesCents: number;
  cityTaxCents: number;
  netRevenueCents: number;
  nightsBooked: number;
  daysInMonth: number;
  fillRate: number;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function overlapNights(checkIn: string, checkOut: string, year: number, month: number): number {
  const checkInMs = Date.parse(`${checkIn}T00:00:00Z`);
  const checkOutMs = Date.parse(`${checkOut}T00:00:00Z`);
  const monthStartMs = Date.UTC(year, month - 1, 1);
  const monthEndMs = Date.UTC(year, month, 1);
  return Math.max(0, (Math.min(checkOutMs, monthEndMs) - Math.max(checkInMs, monthStartMs)) / MS_PER_DAY);
}

function emptyMonths(year: number): MonthlyFinance[] {
  return Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    rentsCents: 0,
    channelFeesCents: 0,
    cityTaxCents: 0,
    netRevenueCents: 0,
    nightsBooked: 0,
    daysInMonth: daysInMonth(year, i + 1),
    fillRate: 0,
  }));
}

function finalizeMonths(months: MonthlyFinance[]): MonthlyFinance[] {
  for (const entry of months) {
    entry.netRevenueCents = entry.rentsCents - entry.channelFeesCents;
    entry.fillRate = entry.daysInMonth > 0 ? entry.nightsBooked / entry.daysInMonth : 0;
  }
  return months;
}

async function addListingMonthlyFinancials(
  months: MonthlyFinance[],
  listingId: string,
  year: number,
  accountByLineType: Map<string, string>
): Promise<void> {
  let page = 1;
  for (;;) {
    const res = await vrPlatformFetch<VrPlatformReservationsResponse>("/reservations", {
      listingId,
      date: String(year),
      dateField: "intersection",
      status: "booked",
      limit: "250",
      page: String(page),
      includeLines: "true",
    });

    for (const reservation of res.data) {
      if (!reservation.checkIn || !reservation.checkOut) continue;

      for (const entry of months) {
        const nights = overlapNights(reservation.checkIn, reservation.checkOut, year, entry.month);
        if (nights > 0) entry.nightsBooked += nights;
      }

      const checkOutDate = new Date(`${reservation.checkOut}T00:00:00Z`);
      if (checkOutDate.getUTCFullYear() === year) {
        const { rentsCents, channelFeesCents, cityTaxCents } = classifyReservationLines(reservation.lines, accountByLineType);
        const entry = months[checkOutDate.getUTCMonth()];
        entry.rentsCents += rentsCents;
        entry.channelFeesCents += channelFeesCents;
        entry.cityTaxCents += cityTaxCents;
      }
    }

    if (page >= res.pagination.totalPage) break;
    page++;
  }
}

export interface PortfolioProperty {
  propertyId: string;
  reference: string;
  name: string | null;
  rentType: "fixe" | "variable" | "fixe_variable" | null;
  rentAmount: number | null;
  commissionPercent: number | null;
  extraVrplatformReferences: string[];
}

/** Résout, pour un bien, les listings VRPlatform qui lui correspondent (sa
 * référence + ses références supplémentaires), à partir d'une liste de
 * listings déjà chargée en mémoire. */
function resolveListingIds(
  references: string[],
  listingsByName: Map<string, VrPlatformListingOption>
): { listingIds: string[]; notFoundReferences: string[] } {
  const listingIds: string[] = [];
  const notFoundReferences: string[] = [];
  for (const reference of references) {
    const listing = listingsByName.get(reference.trim().toLowerCase());
    if (listing) listingIds.push(listing.id);
    else notFoundReferences.push(reference);
  }
  return { listingIds, notFoundReferences };
}

export interface PropertyMonthlyResult {
  propertyId: string;
  reference: string;
  name: string | null;
  isFixedRent: boolean;
  fixedRentAmountCents: number | null;
  commissionPercent: number | null;
  months: MonthlyFinance[];
  notFoundReferences: string[];
}

/** Rents, Channel Fees, Net Commissionable Revenue et taux de remplissage de
 * chaque mois d'une année, pour chaque bien du portefeuille — un seul appel
 * VRPlatform pour la liste des listings et le mapping comptable, puis un
 * calcul par bien (en parallèle) sur ses listings résolus. */
export async function getPortfolioMonthlyFinancials(
  properties: PortfolioProperty[],
  year: number
): Promise<PropertyMonthlyResult[]> {
  const [listings, accountByLineType] = await Promise.all([listVrPlatformListings(), getReservationLineAccountMap()]);
  const listingsByName = new Map(listings.map((l) => [l.name.trim().toLowerCase(), l]));

  return Promise.all(
    properties.map(async (property) => {
      const references = [property.reference, ...property.extraVrplatformReferences];
      const { listingIds, notFoundReferences } = resolveListingIds(references, listingsByName);
      const months = emptyMonths(year);
      for (const listingId of listingIds) {
        await addListingMonthlyFinancials(months, listingId, year, accountByLineType);
      }
      return {
        propertyId: property.propertyId,
        reference: property.reference,
        name: property.name,
        isFixedRent: property.rentType === "fixe",
        fixedRentAmountCents: property.rentAmount != null ? Math.round(property.rentAmount * 100) : null,
        commissionPercent: property.commissionPercent,
        months: finalizeMonths(months),
        notFoundReferences,
      };
    })
  );
}

/** Nuits réservées d'un listing sur un mois donné (borne "intersection" —
 * une réservation à cheval sur le mois compte ses nuits qui tombent dedans). */
async function sumListingNightsForMonth(listingId: string, year: number, month: number): Promise<number> {
  const dateParam = `${year}-${String(month).padStart(2, "0")}`;
  let nightsBooked = 0;
  let page = 1;
  for (;;) {
    const res = await vrPlatformFetch<VrPlatformReservationsResponse>("/reservations", {
      listingId,
      date: dateParam,
      dateField: "intersection",
      status: "booked",
      limit: "250",
      page: String(page),
    });
    for (const reservation of res.data) {
      if (!reservation.checkIn || !reservation.checkOut) continue;
      nightsBooked += overlapNights(reservation.checkIn, reservation.checkOut, year, month);
    }
    if (page >= res.pagination.totalPage) break;
    page++;
  }
  return nightsBooked;
}

export interface PropertyMonthOccupancy {
  month: number;
  nightsBooked: number;
  daysInMonth: number;
  fillRate: number;
}

export interface PropertyOccupancyResult {
  propertyId: string;
  reference: string;
  name: string | null;
  months: PropertyMonthOccupancy[];
  notFoundReferences: string[];
}

/** Taux de remplissage d'un ou plusieurs mois d'une année, pour chaque bien
 * du portefeuille — un bien réparti sur plusieurs listings VRPlatform
 * (référence + références supplémentaires) est regroupé en une seule ligne,
 * comme le reste de l'app. Utilisé par l'onglet Remplissage. */
export async function getPropertyOccupancyForMonths(
  properties: PortfolioProperty[],
  year: number,
  months: number[]
): Promise<PropertyOccupancyResult[]> {
  const listings = await listVrPlatformListings();
  const listingsByName = new Map(listings.map((l) => [l.name.trim().toLowerCase(), l]));

  return Promise.all(
    properties.map(async (property) => {
      const references = [property.reference, ...property.extraVrplatformReferences];
      const { listingIds, notFoundReferences } = resolveListingIds(references, listingsByName);
      const monthResults = await Promise.all(
        months.map(async (month) => {
          const nightsPerListing = await Promise.all(
            listingIds.map((listingId) => sumListingNightsForMonth(listingId, year, month))
          );
          const nightsBooked = nightsPerListing.reduce((sum, n) => sum + n, 0);
          const days = daysInMonth(year, month);
          return { month, nightsBooked, daysInMonth: days, fillRate: days > 0 ? nightsBooked / days : 0 };
        })
      );
      return {
        propertyId: property.propertyId,
        reference: property.reference,
        name: property.name,
        months: monthResults,
        notFoundReferences,
      };
    })
  );
}

/** Dates de check-out (format ISO "AAAA-MM-JJ") d'un listing tombant dans un
 * mois donné. */
async function getListingCheckoutsForMonth(listingId: string, year: number, month: number): Promise<string[]> {
  const dateParam = `${year}-${String(month).padStart(2, "0")}`;
  const checkoutDates: string[] = [];
  let page = 1;
  for (;;) {
    const res = await vrPlatformFetch<VrPlatformReservationsResponse>("/reservations", {
      listingId,
      date: dateParam,
      dateField: "intersection",
      status: "booked",
      limit: "250",
      page: String(page),
    });
    for (const reservation of res.data) {
      if (!reservation.checkOut) continue;
      if (reservation.checkOut.slice(0, 7) === dateParam) checkoutDates.push(reservation.checkOut.slice(0, 10));
    }
    if (page >= res.pagination.totalPage) break;
    page++;
  }
  return checkoutDates;
}

export interface PropertyCheckoutsResult {
  propertyId: string;
  reference: string;
  /** ID Guesty natif du listing principal (référence du bien, hors
   * références supplémentaires) — null si non résolu côté VRPlatform. */
  guestyListingId: string | null;
  checkoutDates: string[];
  notFoundReferences: string[];
}

/** Dates de check-out d'un ou plusieurs mois d'une année, pour chaque bien
 * du portefeuille — biens à plusieurs listings VRPlatform regroupés, comme
 * le reste de l'app. Utilisé par l'onglet Ménage. */
export async function getPropertyCheckoutsForMonths(
  properties: PortfolioProperty[],
  year: number,
  months: number[]
): Promise<PropertyCheckoutsResult[]> {
  const listings = await listVrPlatformListings();
  const listingsByName = new Map(listings.map((l) => [l.name.trim().toLowerCase(), l]));

  return Promise.all(
    properties.map(async (property) => {
      const references = [property.reference, ...property.extraVrplatformReferences];
      const { listingIds, notFoundReferences } = resolveListingIds(references, listingsByName);

      const perListingCheckouts = await Promise.all(
        listingIds.map(async (listingId) => {
          const perMonth = await Promise.all(months.map((month) => getListingCheckoutsForMonth(listingId, year, month)));
          return perMonth.flat();
        })
      );

      const primaryListing = listingsByName.get(property.reference.trim().toLowerCase());

      return {
        propertyId: property.propertyId,
        reference: property.reference,
        guestyListingId: primaryListing?.uniqueRef ?? null,
        checkoutDates: perListingCheckouts.flat().sort(),
        notFoundReferences,
      };
    })
  );
}

export interface YearlyTotal {
  year: number;
  rentsCents: number;
  channelFeesCents: number;
  netRevenueCents: number;
  nightsBooked: number;
  daysInYear: number;
  fillRate: number;
}

/** Total annuel, pour un sous-ensemble de biens (portefeuille entier ou un
 * seul bien), sur plusieurs années — utilisé par la section Tendances. */
export async function getYearlyTotals(properties: PortfolioProperty[], years: number[]): Promise<YearlyTotal[]> {
  const [listings, accountByLineType] = await Promise.all([listVrPlatformListings(), getReservationLineAccountMap()]);
  const listingsByName = new Map(listings.map((l) => [l.name.trim().toLowerCase(), l]));

  const propertyListingIds = properties.map((property) => {
    const references = [property.reference, ...property.extraVrplatformReferences];
    return resolveListingIds(references, listingsByName).listingIds;
  });

  return Promise.all(
    years.map(async (year) => {
      const months = emptyMonths(year);
      await Promise.all(
        propertyListingIds.map(async (listingIds) => {
          for (const listingId of listingIds) {
            await addListingMonthlyFinancials(months, listingId, year, accountByLineType);
          }
        })
      );
      finalizeMonths(months);
      const daysInYear = months.reduce((sum, m) => sum + m.daysInMonth, 0);
      const nightsBooked = months.reduce((sum, m) => sum + m.nightsBooked, 0);
      return {
        year,
        rentsCents: months.reduce((sum, m) => sum + m.rentsCents, 0),
        channelFeesCents: months.reduce((sum, m) => sum + m.channelFeesCents, 0),
        netRevenueCents: months.reduce((sum, m) => sum + m.netRevenueCents, 0),
        nightsBooked,
        daysInYear,
        fillRate: daysInYear > 0 ? nightsBooked / daysInYear : 0,
      };
    })
  );
}
