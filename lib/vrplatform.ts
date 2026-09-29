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
const TRANSFER_FEES_ACCOUNT = "Transfer Fees Revenues";

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

interface VrPlatformAccountsResponse {
  data: { id: string; name: string }[];
  pagination: { page: number; totalPage: number };
}

/** Résout l'ID d'un compte comptable VRPlatform à partir de son nom — les
 * "Transfer Fees Revenues" ne sont pas des lignes de réservation classables
 * via /reservations/line-mappings (ce sont des frais récurrents facturés
 * automatiquement par réservation), il faut donc interroger /reports/journal-entries
 * par ID de compte plutôt que par type de ligne. Cet endpoint /accounts et
 * /reports/journal-entries requièrent le scope "reports:read", pas forcément
 * accordé à la clé API — une erreur ici dégrade silencieusement (Transfer
 * Fees reste à 0) plutôt que de faire échouer tout l'onglet Revenus. */
async function getAccountIdByName(name: string): Promise<string | null> {
  try {
    let page = 1;
    for (;;) {
      const res = await vrPlatformFetch<VrPlatformAccountsResponse>("/accounts", { limit: "250", page: String(page) });
      const found = res.data.find((a) => a.name === name);
      if (found) return found.id;
      if (page >= res.pagination.totalPage) break;
      page++;
    }
    return null;
  } catch {
    return null;
  }
}

interface VrPlatformJournalEntriesResponse {
  data: { txnAt: string; centTotal: number }[];
  pagination: { page: number; totalPage: number };
}

/** Cumule, par mois, les écritures d'un compte comptable donné (ex: Transfer
 * Fees Revenues) pour un listing sur une année — ces frais récurrents sont
 * posés en écritures liées à la réservation mais n'apparaissent pas dans
 * reservation.lines, contrairement aux Rents/Channel Fees/City Tax. */
async function addListingTransferFees(
  months: MonthlyFinance[],
  listingId: string,
  year: number,
  transferFeesAccountId: string
): Promise<void> {
  try {
    let page = 1;
    for (;;) {
      const res = await vrPlatformFetch<VrPlatformJournalEntriesResponse>("/reports/journal-entries", {
        accountIds: transferFeesAccountId,
        listingIds: listingId,
        date: String(year),
        status: "active",
        limit: "250",
        page: String(page),
      });
      for (const entry of res.data) {
        const month = Number(entry.txnAt.slice(5, 7));
        if (month >= 1 && month <= 12) months[month - 1].transferFeesCents += Math.abs(entry.centTotal);
      }
      if (page >= res.pagination.totalPage) break;
      page++;
    }
  } catch {
    // Dégradation silencieuse — voir le commentaire sur getAccountIdByName.
  }
}

// Comptes des sections "Operating & Maintenance Expenses", "Adjustments" et
// "Processing Fees" de la configuration du owner statement VRPlatform
// (GET /statements/layouts, "Default Statement Layout" de l'équipe) — pas de
// correspondance fiable par nom de compte (ex: deux comptes "Payout
// Adjustments" distincts), d'où la liste d'IDs en dur plutôt qu'une
// résolution par nom comme pour Transfer Fees Revenues.
const EXPENSE_ACCOUNT_IDS = [
  // Operating & Maintenance Expenses
  "562002c2-4ee2-49ab-98ad-78760e928a76", // Maintenance
  "4c2860e2-0acc-4b22-b665-38005b8cd610", // Housekeeping
  "3daed64f-aad5-4286-b38d-b11eebe2bf18", // Supplies
  "9a650331-1cc2-40e0-a6e9-462ee6c70d5d", // Insurance
  "988fd364-33c5-4c4a-896e-80a42e7a768e", // Delivery
  "7dfff8bb-3be8-4498-8ba5-8d2798c91815", // Waiting Time
  "7c08b758-4760-4300-aa1f-8af38f7f8b4f", // Expense Reimbursement Revenue
  "26c88bed-c6e3-4fd6-a422-2cea05ec784c", // Expense Reimbursement Revenue - Supplies
  "9927d0a7-fb96-48bb-a585-9359b2b6e36e", // Expense Reimbursement Revenue - Maintenance
  "dea04c5a-824f-4dc6-80f9-eee706a7de3a", // Expense Markup Revenue
  // Adjustments
  "8aa7d442-e286-43ce-a8db-161c3cf4ae7a", // Payout Adjustments (expense)
  "e2f66f13-dc2a-4f0c-a536-29fa20427fff", // Payout Adjustments (revenue)
  "6486ff97-60a2-4bed-93c8-eae682a5939e", // Co-Host Payouts
  "891ffc56-15ee-4ac7-9ace-b670e31361dd", // Guest Refund
  "a9c0d5aa-0f0d-492d-a49a-2d86972baa63", // VRBO comm share Expenses
  "b14d1581-0ca4-4a5d-8a61-d8161c15f38a", // VRBO comm share Revenues
  // Processing Fees
  "eaedcd1b-99d7-4532-96eb-d2144dc7b9ca", // Transfer Fees Expenses
  "53bfbbf0-7432-4521-a275-86abee55b5b3", // Transfer Fees Revenues
];

interface VrPlatformExpenseJournalEntry {
  txnAt: string;
  centTotal: number;
  /** "owners" ou "manager" — les frais récurrents (Transfer Fees, VRBO comm
   * share...) sont postés en PAIRE miroir (même montant, signe opposé) sur
   * deux comptes différents, un côté "owners" et un côté "manager". Sommer
   * les deux comptes de la paire annule tout à zéro : il faut ne garder que
   * le côté "owners", qui représente le vrai coût côté propriétaire. Les
   * écritures hors frais récurrents (dépenses ponctuelles, remboursements)
   * n'ont qu'un seul côté, déjà "owners". */
  party?: string;
  description?: string;
  account?: { id: string; name: string };
  reservationId?: string;
}
interface VrPlatformExpenseJournalEntriesResponse {
  data: VrPlatformExpenseJournalEntry[];
  pagination: { page: number; totalPage: number };
}

/** Toutes les écritures "owners" des comptes EXPENSE_ACCOUNT_IDS pour un
 * listing sur un filtre de date VRPlatform (`"2026"` pour une année,
 * `"2026-09-28...2026-10-27"` pour une plage) — voir le commentaire sur
 * `party` ci-dessus pour pourquoi le filtre sur "owners" est indispensable. */
async function getListingExpenseEntries(listingId: string, dateFilter: string): Promise<VrPlatformExpenseJournalEntry[]> {
  const entries: VrPlatformExpenseJournalEntry[] = [];
  try {
    let page = 1;
    for (;;) {
      const res = await vrPlatformFetch<VrPlatformExpenseJournalEntriesResponse>("/reports/journal-entries", {
        accountIds: EXPENSE_ACCOUNT_IDS.join(","),
        listingIds: listingId,
        date: dateFilter,
        status: "active",
        limit: "250",
        page: String(page),
      });
      for (const entry of res.data) {
        if (entry.party == null || entry.party === "owners") entries.push(entry);
      }
      if (page >= res.pagination.totalPage) break;
      page++;
    }
  } catch {
    // Dégradation silencieuse — voir le commentaire sur getAccountIdByName.
  }
  return entries;
}

async function getListingExpenseCentsByMonth(listingId: string, year: number): Promise<number[]> {
  const totals = new Array(12).fill(0) as number[];
  for (const entry of await getListingExpenseEntries(listingId, String(year))) {
    const month = Number(entry.txnAt.slice(5, 7));
    if (month >= 1 && month <= 12) totals[month - 1] += entry.centTotal;
  }
  return totals;
}

/** Cumule les mêmes écritures que getListingExpenseCentsByMonth, mais
 * groupées par réservation plutôt que par mois — utilisé par la page
 * Réservations pour attribuer les dépenses (Transfer Fees, Adjustments...)
 * à la réservation qui les a déclenchées. */
async function getListingExpenseCentsByReservation(listingId: string, dateFilter: string): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  for (const entry of await getListingExpenseEntries(listingId, dateFilter)) {
    if (!entry.reservationId) continue;
    totals.set(entry.reservationId, (totals.get(entry.reservationId) ?? 0) + entry.centTotal);
  }
  return totals;
}

export interface ExpenseLineItem {
  accountName: string;
  cents: number;
}

export interface PropertyExpenseBreakdown {
  lines: ExpenseLineItem[];
  totalCents: number;
}

/** Détail des lignes qui composent l'Expenses d'un bien sur des mois donnés
 * d'une année — une ligne par compte VRPlatform (voir EXPENSE_ACCOUNT_IDS),
 * triées par montant absolu décroissant. */
export async function getPropertyExpenseBreakdown(
  property: PortfolioProperty,
  year: number,
  months: number[]
): Promise<PropertyExpenseBreakdown> {
  const listings = await listVrPlatformListings();
  const listingsByName = new Map(listings.map((l) => [l.name.trim().toLowerCase(), l]));
  const references = [property.reference, ...property.extraVrplatformReferences];
  const { listingIds } = resolveListingIds(references, listingsByName);

  const byAccount = new Map<string, number>();
  for (const listingId of listingIds) {
    for (const entry of await getListingExpenseEntries(listingId, String(year))) {
      const month = Number(entry.txnAt.slice(5, 7));
      if (!months.includes(month)) continue;
      const name = entry.account?.name ?? "Autre";
      byAccount.set(name, (byAccount.get(name) ?? 0) + entry.centTotal);
    }
  }

  const lines = Array.from(byAccount.entries())
    .map(([accountName, cents]) => ({ accountName, cents }))
    .sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents));
  const totalCents = lines.reduce((sum, l) => sum + l.cents, 0);

  return { lines, totalCents };
}

interface VrPlatformReservationDetailed {
  id: string;
  checkIn: string | null;
  checkOut: string | null;
  bookedAt: string | null;
  nights: number;
  guestName: string | null;
  confirmationCode: string | null;
  bookingPlatform: string | null;
  status: "booked" | "canceled" | "inactive";
  lines: VrPlatformReservationLine[] | null;
}
interface VrPlatformReservationsDetailedResponse {
  data: VrPlatformReservationDetailed[];
  pagination: { page: number; totalPage: number };
}

export interface ReservationDetail {
  reservationId: string;
  checkIn: string;
  checkOut: string;
  /** Date à laquelle la réservation a été effectuée (bookedAt VRPlatform),
   * distincte des dates de séjour. */
  bookedAt: string | null;
  nights: number;
  guestName: string | null;
  confirmationCode: string | null;
  bookingPlatform: string | null;
  /** Rents / nuits — prix brut côté hébergement, avant déduction des
   * Channel Fees. */
  grossNightlyRateCents: number | null;
  netCommissionableRevenueCents: number;
  commissionCents: number;
  expensesCents: number;
  netRevenueCents: number;
}

/** Détail réservation par réservation (et non agrégé par mois) pour un bien
 * sur des mois donnés d'une année — mêmes grandeurs que l'onglet Owner
 * (Net Commissionable Revenue, Commission, Expenses, Net Revenue), sans
 * Loyer/Excess qui n'ont pas de sens au niveau d'une réservation, plus le
 * prix brut par nuit. Une réservation est attribuée au mois de son
 * check-out, comme le reste de l'app (voir addListingMonthlyFinancials). */
export async function getPropertyReservationDetails(
  property: PortfolioProperty,
  year: number,
  months: number[]
): Promise<ReservationDetail[]> {
  const [listings, accountByLineType] = await Promise.all([listVrPlatformListings(), getReservationLineAccountMap()]);
  const listingsByName = new Map(listings.map((l) => [l.name.trim().toLowerCase(), l]));
  const references = [property.reference, ...property.extraVrplatformReferences];
  const { listingIds } = resolveListingIds(references, listingsByName);
  const commissionPercent = property.commissionPercent ?? 0;

  const results: ReservationDetail[] = [];

  for (const listingId of listingIds) {
    const expenseByReservation = await getListingExpenseCentsByReservation(listingId, String(year));
    let page = 1;
    for (;;) {
      const res = await vrPlatformFetch<VrPlatformReservationsDetailedResponse>("/reservations", {
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
        const checkOutDate = new Date(`${reservation.checkOut}T00:00:00Z`);
        if (checkOutDate.getUTCFullYear() !== year || !months.includes(checkOutDate.getUTCMonth() + 1)) continue;

        const { rentsCents, channelFeesCents } = classifyReservationLines(reservation.lines, accountByLineType);
        const netCommissionableRevenueCents = rentsCents - channelFeesCents;
        const commissionCents = Math.round((netCommissionableRevenueCents * commissionPercent) / 100);
        const netRevenueCents = netCommissionableRevenueCents - commissionCents;
        const expensesCents = Math.abs(expenseByReservation.get(reservation.id) ?? 0);
        const grossNightlyRateCents = reservation.nights > 0 ? Math.round(rentsCents / reservation.nights) : null;

        results.push({
          reservationId: reservation.id,
          checkIn: reservation.checkIn,
          checkOut: reservation.checkOut,
          bookedAt: reservation.bookedAt,
          nights: reservation.nights,
          guestName: reservation.guestName,
          confirmationCode: reservation.confirmationCode,
          bookingPlatform: reservation.bookingPlatform,
          grossNightlyRateCents,
          netCommissionableRevenueCents,
          commissionCents,
          expensesCents,
          netRevenueCents,
        });
      }
      if (page >= res.pagination.totalPage) break;
      page++;
    }
  }

  return results.sort((a, b) => a.checkIn.localeCompare(b.checkIn));
}

export interface PortfolioReservationDetail extends ReservationDetail {
  propertyId: string;
  reference: string;
  /** City Tax de cette réservation (ligne dédiée côté VRPlatform) — sert au
   * calcul du Profit Melvane (Commission + City Tax + Profit ménage, même
   * formule que l'onglet Revenus), pas à celui du Net Revenue propriétaire. */
  cityTaxCents: number;
  /** Transfer Fees de cette réservation (écriture comptable liée à la
   * réservation via reservationId, cf. /reports/journal-entries — pas dans
   * reservation.lines) — sert aussi au calcul du Profit Melvane. */
  transferFeesCents: number;
}

interface VrPlatformJournalEntriesWithReservationResponse {
  data: { txnAt: string; centTotal: number; reservationId: string | null }[];
  pagination: { page: number; totalPage: number };
}

/** Transfer Fees d'un listing sur une année, regroupés par reservationId —
 * même requête que addListingTransferFees, mais on lit aussi reservationId
 * sur chaque écriture (déjà renvoyé par l'API) pour attribuer le montant à
 * la réservation plutôt qu'au mois. */
async function getListingTransferFeesByReservation(
  listingId: string,
  year: number,
  transferFeesAccountId: string | null
): Promise<Map<string, number>> {
  const byReservation = new Map<string, number>();
  if (!transferFeesAccountId) return byReservation;
  try {
    let page = 1;
    for (;;) {
      const res = await vrPlatformFetch<VrPlatformJournalEntriesWithReservationResponse>("/reports/journal-entries", {
        accountIds: transferFeesAccountId,
        listingIds: listingId,
        date: String(year),
        status: "active",
        limit: "250",
        page: String(page),
      });
      for (const entry of res.data) {
        if (!entry.reservationId) continue;
        byReservation.set(entry.reservationId, (byReservation.get(entry.reservationId) ?? 0) + Math.abs(entry.centTotal));
      }
      if (page >= res.pagination.totalPage) break;
      page++;
    }
  } catch {
    // Dégradation silencieuse — voir le commentaire sur getAccountIdByName.
  }
  return byReservation;
}

/** Version portefeuille de getPropertyReservationDetails — un seul appel
 * /listings + mapping comptable partagés entre tous les biens (au lieu d'un
 * appel par bien), résultats fusionnés en une seule liste avec propertyId/
 * reference pour pouvoir les afficher/trier/filtrer par bien. Utilisé par
 * l'onglet Réservations en sélection multi-biens (voir PropertyFinanceTable
 * pour le même principe de filtre biens/modèle/tags). */
export async function getPortfolioReservationDetails(
  properties: PortfolioProperty[],
  year: number,
  months: number[]
): Promise<PortfolioReservationDetail[]> {
  const [listings, accountByLineType, transferFeesAccountId] = await Promise.all([
    listVrPlatformListings(),
    getReservationLineAccountMap(),
    getAccountIdByName(TRANSFER_FEES_ACCOUNT),
  ]);
  const listingsByName = new Map(listings.map((l) => [l.name.trim().toLowerCase(), l]));

  const perProperty = await Promise.all(
    properties.map(async (property) => {
      const references = [property.reference, ...property.extraVrplatformReferences];
      const { listingIds } = resolveListingIds(references, listingsByName);
      const commissionPercent = property.commissionPercent ?? 0;
      const results: PortfolioReservationDetail[] = [];

      for (const listingId of listingIds) {
        const [expenseByReservation, transferFeesByReservation] = await Promise.all([
          getListingExpenseCentsByReservation(listingId, String(year)),
          getListingTransferFeesByReservation(listingId, year, transferFeesAccountId),
        ]);
        let page = 1;
        for (;;) {
          const res = await vrPlatformFetch<VrPlatformReservationsDetailedResponse>("/reservations", {
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
            const checkOutDate = new Date(`${reservation.checkOut}T00:00:00Z`);
            if (checkOutDate.getUTCFullYear() !== year || !months.includes(checkOutDate.getUTCMonth() + 1)) continue;

            const { rentsCents, channelFeesCents, cityTaxCents } = classifyReservationLines(reservation.lines, accountByLineType);
            const netCommissionableRevenueCents = rentsCents - channelFeesCents;
            const commissionCents = Math.round((netCommissionableRevenueCents * commissionPercent) / 100);
            const netRevenueCents = netCommissionableRevenueCents - commissionCents;
            const expensesCents = Math.abs(expenseByReservation.get(reservation.id) ?? 0);
            const transferFeesCents = transferFeesByReservation.get(reservation.id) ?? 0;
            const grossNightlyRateCents = reservation.nights > 0 ? Math.round(rentsCents / reservation.nights) : null;

            results.push({
              propertyId: property.propertyId,
              reference: property.reference,
              reservationId: reservation.id,
              checkIn: reservation.checkIn,
              checkOut: reservation.checkOut,
              bookedAt: reservation.bookedAt,
              nights: reservation.nights,
              guestName: reservation.guestName,
              confirmationCode: reservation.confirmationCode,
              bookingPlatform: reservation.bookingPlatform,
              grossNightlyRateCents,
              netCommissionableRevenueCents,
              commissionCents,
              expensesCents,
              netRevenueCents,
              cityTaxCents,
              transferFeesCents,
            });
          }
          if (page >= res.pagination.totalPage) break;
          page++;
        }
      }
      return results;
    })
  );

  return perProperty.flat().sort((a, b) => a.checkIn.localeCompare(b.checkIn));
}

/** Version "plage de dates" de getPropertyReservationDetails — filtre
 * directement côté serveur (dateField=checkOut) sur [startDate, endDate]
 * (inclus, YYYY-MM-DD) au lieu d'une année + une liste de mois. Utilisé par
 * l'onglet Analyse en mode plage de dates. */
export async function getPropertyReservationDetailsForDateRange(
  property: PortfolioProperty,
  startDate: string,
  endDate: string
): Promise<ReservationDetail[]> {
  const [listings, accountByLineType] = await Promise.all([listVrPlatformListings(), getReservationLineAccountMap()]);
  const listingsByName = new Map(listings.map((l) => [l.name.trim().toLowerCase(), l]));
  const references = [property.reference, ...property.extraVrplatformReferences];
  const { listingIds } = resolveListingIds(references, listingsByName);
  const commissionPercent = property.commissionPercent ?? 0;
  const rangeFilter = `${startDate}...${endDate}`;

  const results: ReservationDetail[] = [];

  for (const listingId of listingIds) {
    const expenseByReservation = await getListingExpenseCentsByReservation(listingId, rangeFilter);
    let page = 1;
    for (;;) {
      const res = await vrPlatformFetch<VrPlatformReservationsDetailedResponse>("/reservations", {
        listingId,
        date: rangeFilter,
        dateField: "checkOut",
        status: "booked",
        limit: "250",
        page: String(page),
        includeLines: "true",
      });
      for (const reservation of res.data) {
        if (!reservation.checkIn || !reservation.checkOut) continue;

        const { rentsCents, channelFeesCents } = classifyReservationLines(reservation.lines, accountByLineType);
        const netCommissionableRevenueCents = rentsCents - channelFeesCents;
        const commissionCents = Math.round((netCommissionableRevenueCents * commissionPercent) / 100);
        const netRevenueCents = netCommissionableRevenueCents - commissionCents;
        const expensesCents = Math.abs(expenseByReservation.get(reservation.id) ?? 0);
        const grossNightlyRateCents = reservation.nights > 0 ? Math.round(rentsCents / reservation.nights) : null;

        results.push({
          reservationId: reservation.id,
          checkIn: reservation.checkIn,
          checkOut: reservation.checkOut,
          bookedAt: reservation.bookedAt,
          nights: reservation.nights,
          guestName: reservation.guestName,
          confirmationCode: reservation.confirmationCode,
          bookingPlatform: reservation.bookingPlatform,
          grossNightlyRateCents,
          netCommissionableRevenueCents,
          commissionCents,
          expensesCents,
          netRevenueCents,
        });
      }
      if (page >= res.pagination.totalPage) break;
      page++;
    }
  }

  return results.sort((a, b) => a.checkIn.localeCompare(b.checkIn));
}

export interface UpcomingReservationRate {
  confirmationCode: string | null;
  /** Rents / nuits — prix brut réellement facturé pour cette réservation,
   * même calcul que ReservationDetail.grossNightlyRateCents. */
  grossNightlyRateCents: number | null;
}

/** Prix brut/nuit réellement facturé des réservations dont le séjour croise
 * [startDate, endDate] (YYYY-MM-DD, incluses), pour chaque bien du
 * portefeuille — sert à retrouver le prix réellement vendu d'une nuit
 * occupée sur le calendrier Guesty (dont le prix affiché reflète le tarif
 * du jour, pas ce qui a été payé), voir /api/finance/booking-window-portfolio.
 * Contrairement à getPropertyReservationDetails, filtre par intersection de
 * séjour et pas par mois de check-out : une réservation encore à venir doit
 * être incluse même si son check-out n'est pas encore connu comme "dans la
 * période". */
export async function getPortfolioUpcomingReservationRates(
  properties: PortfolioProperty[],
  startDate: string,
  endDate: string
): Promise<Map<string, UpcomingReservationRate[]>> {
  const [listings, accountByLineType] = await Promise.all([listVrPlatformListings(), getReservationLineAccountMap()]);
  const listingsByName = new Map(listings.map((l) => [l.name.trim().toLowerCase(), l]));
  const dateFilter = `${startDate}...${endDate}`;

  const entries = await Promise.all(
    properties.map(async (property) => {
      const references = [property.reference, ...property.extraVrplatformReferences];
      const { listingIds } = resolveListingIds(references, listingsByName);
      const rates: UpcomingReservationRate[] = [];

      for (const listingId of listingIds) {
        let page = 1;
        for (;;) {
          const res = await vrPlatformFetch<VrPlatformReservationsDetailedResponse>("/reservations", {
            listingId,
            date: dateFilter,
            dateField: "intersection",
            status: "booked",
            limit: "250",
            page: String(page),
            includeLines: "true",
          });
          for (const reservation of res.data) {
            const { rentsCents } = classifyReservationLines(reservation.lines, accountByLineType);
            const grossNightlyRateCents = reservation.nights > 0 ? Math.round(rentsCents / reservation.nights) : null;
            rates.push({ confirmationCode: reservation.confirmationCode, grossNightlyRateCents });
          }
          if (page >= res.pagination.totalPage) break;
          page++;
        }
      }

      return [property.propertyId, rates] as const;
    })
  );

  return new Map(entries);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export interface BookingWindowStats {
  /** Nombre de réservations faites (bookedAt) sur les 12 derniers mois,
   * entrant dans le calcul — quelle que soit la date de check-in, y compris
   * les séjours encore à venir. */
  sampleSize: number;
  /** Médiane du nombre de jours entre la date de réservation (bookedAt) et
   * le check-in — la "fenêtre de réservation". */
  medianLeadTimeDays: number | null;
  /** Durée moyenne de séjour (nuits), sur le même échantillon. */
  avgLengthOfStayNights: number | null;
  /** Répartition des réservations par fenêtre de réservation (% de
   * sampleSize, null si sampleSize == 0) : moins de 7 jours, de 7 à 15 jours
   * inclus, plus de 15 jours. */
  leadTimeBuckets: {
    under7Percent: number | null;
    from7To15Percent: number | null;
    over15Percent: number | null;
  };
}

function bookingWindowDateFilter(referenceDate: Date): string {
  const until = referenceDate;
  const since = new Date(until);
  since.setUTCFullYear(since.getUTCFullYear() - 1);
  return `${since.toISOString().slice(0, 10)}...${until.toISOString().slice(0, 10)}`;
}

async function fetchBookingWindowForListings(listingIds: string[], dateFilter: string): Promise<BookingWindowStats> {
  const leadTimesDays: number[] = [];
  const nightsList: number[] = [];

  for (const listingId of listingIds) {
    let page = 1;
    for (;;) {
      const res = await vrPlatformFetch<VrPlatformReservationsDetailedResponse>("/reservations", {
        listingId,
        date: dateFilter,
        dateField: "bookedAt",
        status: "booked",
        limit: "250",
        page: String(page),
      });
      for (const reservation of res.data) {
        if (!reservation.checkIn || !reservation.bookedAt) continue;
        const bookedAtMs = new Date(`${reservation.bookedAt}T00:00:00Z`).getTime();
        const checkInMs = new Date(`${reservation.checkIn}T00:00:00Z`).getTime();
        const leadTimeDays = Math.round((checkInMs - bookedAtMs) / MS_PER_DAY);
        if (Number.isFinite(leadTimeDays)) leadTimesDays.push(leadTimeDays);
        if (reservation.nights != null) nightsList.push(reservation.nights);
      }
      if (page >= res.pagination.totalPage) break;
      page++;
    }
  }

  const sampleSize = leadTimesDays.length;
  const under7 = leadTimesDays.filter((d) => d < 7).length;
  const from7To15 = leadTimesDays.filter((d) => d >= 7 && d <= 15).length;
  const over15 = leadTimesDays.filter((d) => d > 15).length;

  return {
    sampleSize,
    medianLeadTimeDays: median(leadTimesDays),
    avgLengthOfStayNights: nightsList.length > 0 ? nightsList.reduce((sum, n) => sum + n, 0) / nightsList.length : null,
    leadTimeBuckets: {
      under7Percent: sampleSize > 0 ? (under7 / sampleSize) * 100 : null,
      from7To15Percent: sampleSize > 0 ? (from7To15 / sampleSize) * 100 : null,
      over15Percent: sampleSize > 0 ? (over15 / sampleSize) * 100 : null,
    },
  };
}

/** Fenêtre de réservation médiane et durée moyenne de séjour, sur les
 * réservations FAITES (bookedAt) au cours des 12 derniers mois glissants —
 * y compris celles dont le check-in est encore à venir. Bascule
 * volontairement sur dateField=bookedAt (contrairement au reste de l'app,
 * qui attribue une réservation au mois de son check-out) car la question
 * posée ici est "quand réserve-t-on", pas "quand facture-t-on". */
export async function getPropertyBookingWindowStats(
  property: PortfolioProperty,
  referenceDate: Date = new Date()
): Promise<BookingWindowStats> {
  const listings = await listVrPlatformListings();
  const listingsByName = new Map(listings.map((l) => [l.name.trim().toLowerCase(), l]));
  const references = [property.reference, ...property.extraVrplatformReferences];
  const { listingIds } = resolveListingIds(references, listingsByName);
  return fetchBookingWindowForListings(listingIds, bookingWindowDateFilter(referenceDate));
}

export interface PropertyBookingWindowResult extends BookingWindowStats {
  propertyId: string;
  reference: string;
  notFoundReferences: string[];
  /** ID Guesty natif du listing principal (référence du bien, hors
   * références supplémentaires) — null si non résolu côté VRPlatform. Sert
   * à enchaîner un calcul basé sur le calendrier Guesty (ex. TR à court
   * terme) sans refaire de résolution de listing. */
  guestyListingId: string | null;
}

/** Version portefeuille de getPropertyBookingWindowStats — un seul appel
 * /listings partagé entre tous les biens, puis une requête par bien (en
 * parallèle) sur ses listings résolus. Utilisé par l'onglet Remplissage. */
export async function getPortfolioBookingWindowStats(
  properties: PortfolioProperty[],
  referenceDate: Date = new Date()
): Promise<PropertyBookingWindowResult[]> {
  const listings = await listVrPlatformListings();
  const listingsByName = new Map(listings.map((l) => [l.name.trim().toLowerCase(), l]));
  const dateFilter = bookingWindowDateFilter(referenceDate);

  return Promise.all(
    properties.map(async (property) => {
      const references = [property.reference, ...property.extraVrplatformReferences];
      const { listingIds, notFoundReferences } = resolveListingIds(references, listingsByName);
      const stats = await fetchBookingWindowForListings(listingIds, dateFilter);
      const primaryListing = listingsByName.get(property.reference.trim().toLowerCase());
      return {
        propertyId: property.propertyId,
        reference: property.reference,
        notFoundReferences,
        guestyListingId: primaryListing?.uniqueRef ?? null,
        ...stats,
      };
    })
  );
}

export interface MonthlyFinance {
  /** 1 (janvier) à 12 (décembre). */
  month: number;
  rentsCents: number;
  channelFeesCents: number;
  cityTaxCents: number;
  transferFeesCents: number;
  /** Somme des sections "Operating & Maintenance Expenses", "Adjustments" et
   * "Processing Fees" de la configuration du owner statement VRPlatform
   * (voir EXPENSE_ACCOUNT_IDS) — 0 si non demandé via includeExpenses. */
  expensesCents: number;
  netRevenueCents: number;
  /** Nuits occupées dans le mois calendaire (réparties par intersection —
   * une réservation à cheval sur deux mois compte ses nuits dans chacun).
   * Sert au taux de remplissage. Ne pas diviser rentsCents par ce champ :
   * rentsCents est attribué en entier au mois de check-out (voir
   * checkoutNights), pas réparti par intersection comme nightsBooked — les
   * deux bases ne sont pas comparables. */
  nightsBooked: number;
  /** Nuits totales des réservations dont le check-out tombe dans ce mois —
   * même base d'attribution que rentsCents (réservation entière, mois de
   * check-out), contrairement à nightsBooked. À utiliser pour calculer un
   * prix moyen par nuit (rentsCents / checkoutNights). */
  checkoutNights: number;
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
    transferFeesCents: 0,
    expensesCents: 0,
    netRevenueCents: 0,
    nightsBooked: 0,
    checkoutNights: 0,
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
        const checkInMs = Date.parse(`${reservation.checkIn}T00:00:00Z`);
        const checkOutMs = Date.parse(`${reservation.checkOut}T00:00:00Z`);
        entry.checkoutNights += Math.round((checkOutMs - checkInMs) / MS_PER_DAY);
      }
    }

    if (page >= res.pagination.totalPage) break;
    page++;
  }
}

/** ID Guesty natif du listing VRPlatform correspondant à une référence de
 * bien — utilisé par la vue calendrier de l'espace propriétaire pour
 * interroger l'API Guesty directement. */
export async function getGuestyListingIdForReference(reference: string): Promise<string | null> {
  const listings = await listVrPlatformListings();
  const match = listings.find((l) => l.name.trim().toLowerCase() === reference.trim().toLowerCase());
  return match?.uniqueRef ?? null;
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

/** ID Guesty du listing principal de chaque bien du portefeuille (référence
 * exacte, pas les références supplémentaires), en un seul appel /listings
 * partagé — plus efficace que d'appeler getGuestyListingIdForReference une
 * fois par bien (qui refait un appel /listings complet à chaque fois). */
export async function getPortfolioGuestyListingIds(
  properties: PortfolioProperty[]
): Promise<Map<string, string | null>> {
  const listings = await listVrPlatformListings();
  const listingsByName = new Map(listings.map((l) => [l.name.trim().toLowerCase(), l]));
  return new Map(
    properties.map((property) => [
      property.propertyId,
      listingsByName.get(property.reference.trim().toLowerCase())?.uniqueRef ?? null,
    ])
  );
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
 * calcul par bien (en parallèle) sur ses listings résolus. `includeExpenses`
 * ajoute un appel /reports/journal-entries supplémentaire par listing (voir
 * EXPENSE_ACCOUNT_IDS) — désactivé par défaut pour ne pas ralentir les
 * onglets qui n'en ont pas besoin. */
export async function getPortfolioMonthlyFinancials(
  properties: PortfolioProperty[],
  year: number,
  options: { includeExpenses?: boolean } = {}
): Promise<PropertyMonthlyResult[]> {
  const [listings, accountByLineType, transferFeesAccountId] = await Promise.all([
    listVrPlatformListings(),
    getReservationLineAccountMap(),
    getAccountIdByName(TRANSFER_FEES_ACCOUNT),
  ]);
  const listingsByName = new Map(listings.map((l) => [l.name.trim().toLowerCase(), l]));

  return Promise.all(
    properties.map(async (property) => {
      const references = [property.reference, ...property.extraVrplatformReferences];
      const { listingIds, notFoundReferences } = resolveListingIds(references, listingsByName);
      const months = emptyMonths(year);
      const rawExpenseCentsByMonth = new Array(12).fill(0) as number[];
      for (const listingId of listingIds) {
        await addListingMonthlyFinancials(months, listingId, year, accountByLineType);
        if (transferFeesAccountId) await addListingTransferFees(months, listingId, year, transferFeesAccountId);
        if (options.includeExpenses) {
          const listingExpenses = await getListingExpenseCentsByMonth(listingId, year);
          for (let i = 0; i < 12; i++) rawExpenseCentsByMonth[i] += listingExpenses[i];
        }
      }
      if (options.includeExpenses) {
        for (let i = 0; i < 12; i++) months[i].expensesCents = Math.abs(rawExpenseCentsByMonth[i]);
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

function overlapNightsInRange(checkIn: string, checkOut: string, startDate: string, endDate: string): number {
  const checkInMs = Date.parse(`${checkIn}T00:00:00Z`);
  const checkOutMs = Date.parse(`${checkOut}T00:00:00Z`);
  const rangeStartMs = Date.parse(`${startDate}T00:00:00Z`);
  const rangeEndMs = Date.parse(`${endDate}T00:00:00Z`) + MS_PER_DAY; // endDate incluse
  return Math.max(0, (Math.min(checkOutMs, rangeEndMs) - Math.max(checkInMs, rangeStartMs)) / MS_PER_DAY);
}

export interface RangeFinance {
  startDate: string;
  endDate: string;
  rentsCents: number;
  channelFeesCents: number;
  cityTaxCents: number;
  transferFeesCents: number;
  expensesCents: number;
  netRevenueCents: number;
  /** Nuits occupées dans la plage (intersection — une réservation à cheval
   * sur une borne compte ses nuits qui tombent dedans). */
  nightsBooked: number;
  /** Nuits des réservations dont le check-out tombe dans la plage — même
   * base d'attribution que rentsCents (voir MonthlyFinance.checkoutNights). */
  checkoutNights: number;
  daysInRange: number;
  fillRate: number;
}

export interface PropertyRangeResult {
  propertyId: string;
  reference: string;
  name: string | null;
  isFixedRent: boolean;
  fixedRentAmountCents: number | null;
  commissionPercent: number | null;
  finance: RangeFinance;
  notFoundReferences: string[];
}

/** Version "plage de dates" de getPortfolioMonthlyFinancials — un seul
 * bucket au lieu d'un par mois calendaire, pour un intervalle [startDate,
 * endDate] arbitraire (inclus, YYYY-MM-DD, peut chevaucher deux mois ou deux
 * années). Utilisé par l'onglet Analyse en mode "plage de dates" (ex. les 30
 * prochains jours, ouvert depuis l'onglet Tendances). */
export async function getPortfolioFinancialsForDateRange(
  properties: PortfolioProperty[],
  startDate: string,
  endDate: string,
  options: { includeExpenses?: boolean } = {}
): Promise<PropertyRangeResult[]> {
  const [listings, accountByLineType, transferFeesAccountId] = await Promise.all([
    listVrPlatformListings(),
    getReservationLineAccountMap(),
    getAccountIdByName(TRANSFER_FEES_ACCOUNT),
  ]);
  const listingsByName = new Map(listings.map((l) => [l.name.trim().toLowerCase(), l]));
  const rangeFilter = `${startDate}...${endDate}`;
  const daysInRange =
    Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / MS_PER_DAY) + 1;

  return Promise.all(
    properties.map(async (property) => {
      const references = [property.reference, ...property.extraVrplatformReferences];
      const { listingIds, notFoundReferences } = resolveListingIds(references, listingsByName);

      let rentsCents = 0;
      let channelFeesCents = 0;
      let cityTaxCents = 0;
      let transferFeesCents = 0;
      let expensesCents = 0;
      let nightsBooked = 0;
      let checkoutNights = 0;

      for (const listingId of listingIds) {
        // Nuits occupées (intersection, comptage partiel sur les bornes).
        let page = 1;
        for (;;) {
          const res = await vrPlatformFetch<VrPlatformReservationsResponse>("/reservations", {
            listingId,
            date: rangeFilter,
            dateField: "intersection",
            status: "booked",
            limit: "250",
            page: String(page),
          });
          for (const reservation of res.data) {
            if (!reservation.checkIn || !reservation.checkOut) continue;
            nightsBooked += overlapNightsInRange(reservation.checkIn, reservation.checkOut, startDate, endDate);
          }
          if (page >= res.pagination.totalPage) break;
          page++;
        }

        // Rents/Channel Fees/City Tax/checkoutNights (check-out dans la plage).
        page = 1;
        for (;;) {
          const res = await vrPlatformFetch<VrPlatformReservationsDetailedResponse>("/reservations", {
            listingId,
            date: rangeFilter,
            dateField: "checkOut",
            status: "booked",
            limit: "250",
            page: String(page),
            includeLines: "true",
          });
          for (const reservation of res.data) {
            if (!reservation.checkIn || !reservation.checkOut) continue;
            const { rentsCents: r, channelFeesCents: c, cityTaxCents: t } = classifyReservationLines(
              reservation.lines,
              accountByLineType
            );
            rentsCents += r;
            channelFeesCents += c;
            cityTaxCents += t;
            const checkInMs = Date.parse(`${reservation.checkIn}T00:00:00Z`);
            const checkOutMs = Date.parse(`${reservation.checkOut}T00:00:00Z`);
            checkoutNights += Math.round((checkOutMs - checkInMs) / MS_PER_DAY);
          }
          if (page >= res.pagination.totalPage) break;
          page++;
        }

        // Transfer Fees (écritures comptables, pas dans reservation.lines).
        if (transferFeesAccountId) {
          try {
            let p = 1;
            for (;;) {
              const res = await vrPlatformFetch<VrPlatformJournalEntriesResponse>("/reports/journal-entries", {
                accountIds: transferFeesAccountId,
                listingIds: listingId,
                date: rangeFilter,
                status: "active",
                limit: "250",
                page: String(p),
              });
              for (const entry of res.data) transferFeesCents += Math.abs(entry.centTotal);
              if (p >= res.pagination.totalPage) break;
              p++;
            }
          } catch {
            // Dégradation silencieuse — voir le commentaire sur getAccountIdByName.
          }
        }

        if (options.includeExpenses) {
          for (const entry of await getListingExpenseEntries(listingId, rangeFilter)) {
            expensesCents += Math.abs(entry.centTotal);
          }
        }
      }

      const netRevenueCents = rentsCents - channelFeesCents;
      const fillRate = daysInRange > 0 ? nightsBooked / daysInRange : 0;

      return {
        propertyId: property.propertyId,
        reference: property.reference,
        name: property.name,
        isFixedRent: property.rentType === "fixe",
        fixedRentAmountCents: property.rentAmount != null ? Math.round(property.rentAmount * 100) : null,
        commissionPercent: property.commissionPercent,
        finance: {
          startDate,
          endDate,
          rentsCents,
          channelFeesCents,
          cityTaxCents,
          transferFeesCents,
          expensesCents,
          netRevenueCents,
          nightsBooked,
          checkoutNights,
          daysInRange,
          fillRate,
        },
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

/** Version "plage de dates" de getPropertyCheckoutsForMonths — filtre
 * directement côté serveur (dateField=checkOut) sur [startDate, endDate]
 * (inclus, YYYY-MM-DD). Utilisé par l'onglet Analyse en mode plage de
 * dates. */
export async function getPropertyCheckoutsForDateRange(
  properties: PortfolioProperty[],
  startDate: string,
  endDate: string
): Promise<PropertyCheckoutsResult[]> {
  const listings = await listVrPlatformListings();
  const listingsByName = new Map(listings.map((l) => [l.name.trim().toLowerCase(), l]));
  const rangeFilter = `${startDate}...${endDate}`;

  return Promise.all(
    properties.map(async (property) => {
      const references = [property.reference, ...property.extraVrplatformReferences];
      const { listingIds, notFoundReferences } = resolveListingIds(references, listingsByName);

      const perListingCheckouts = await Promise.all(
        listingIds.map(async (listingId) => {
          const checkoutDates: string[] = [];
          let page = 1;
          for (;;) {
            const res = await vrPlatformFetch<VrPlatformReservationsResponse>("/reservations", {
              listingId,
              date: rangeFilter,
              dateField: "checkOut",
              status: "booked",
              limit: "250",
              page: String(page),
            });
            for (const reservation of res.data) {
              if (reservation.checkOut) checkoutDates.push(reservation.checkOut.slice(0, 10));
            }
            if (page >= res.pagination.totalPage) break;
            page++;
          }
          return checkoutDates;
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

