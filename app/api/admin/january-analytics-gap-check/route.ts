import { NextResponse } from "next/server";
import { getCurrentProfile, listPropertiesForFinance } from "@/lib/queries";

export const dynamic = "force-dynamic";

// TEMPORAIRE — diagnostic pour comprendre l'écart entre le rapport VRPlatform
// "Données analytiques de propriété" (3 817,67 € pour janvier 2027 sur
// St-Honoré/Raynouard/St-Sauveur) et la somme manuelle des réservations
// Guesty (2 673,92 €). On liste TOUTES les réservations (booked ET
// canceled) qui touchent décembre 2026 / janvier / février 2027 pour ces
// 3 biens, avec toutes leurs lignes, pour trouver ce qui compose l'écart
// (ex: une résa annulée dont des lignes financières restent actives).

const API_BASE_URL = "https://api.vrplatform.app";
const REFERENCE_QUERIES = ["097STHON", "32RAYN", "47STSAUV"];
const DATE_RANGE = "2026-12-01...2027-02-28";
const STATUSES = ["booked", "canceled", "inactive"] as const;

function normalizeRef(ref: string): string {
  return ref.trim().toLowerCase().replace(/\s+/g, "");
}

async function vrPlatformFetchRaw(path: string, query: Record<string, string>): Promise<unknown> {
  const apiKey = process.env.VRPLATFORM_API_KEY;
  const teamId = process.env.VRPLATFORM_TEAM_ID;
  if (!apiKey || !teamId) throw new Error("VRPlatform n'est pas configuré.");
  const url = new URL(path, API_BASE_URL);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { "x-api-key": apiKey, "x-team-id": teamId }, cache: "no-store" });
  if (!response.ok) throw new Error(`VRPlatform a répondu ${response.status} sur ${path}.`);
  return response.json();
}

interface VrListing {
  id: string;
  name: string | null;
  title: string | null;
  uniqueRef: string | null;
}
interface VrListingsResponse {
  data: VrListing[];
  pagination: { page: number; totalPage: number };
}

async function listAllVrListings(): Promise<VrListing[]> {
  const out: VrListing[] = [];
  let page = 1;
  for (;;) {
    const res = (await vrPlatformFetchRaw("/listings", { limit: "250", page: String(page) })) as VrListingsResponse;
    out.push(...res.data);
    if (page >= res.pagination.totalPage) break;
    page++;
  }
  return out;
}

interface LineMappingsResponse {
  data: { type: string; account: { name: string } | null }[];
  pagination: { page: number; totalPage: number };
}

async function getAccountByLineType(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let page = 1;
  for (;;) {
    const res = (await vrPlatformFetchRaw("/reservations/line-mappings", {
      limit: "250",
      page: String(page),
    })) as LineMappingsResponse;
    for (const m of res.data) if (m.account) map.set(m.type, m.account.name);
    if (page >= res.pagination.totalPage) break;
    page++;
  }
  return map;
}

const RENTS_ACCOUNT = "Rents";
const CHANNEL_COMMISSION_ACCOUNTS = new Set(["Channel Commissions - Airbnb", "Channel Commissions (Reference Account)"]);
const CITY_TAX_ACCOUNT = "City Taxes Revenue";

interface RawReservation {
  [key: string]: unknown;
  checkIn?: string | null;
  checkOut?: string | null;
  status?: string;
  lines?: { type: string | null; amount: number | null }[] | null;
}
interface ReservationsResponse {
  data: RawReservation[];
  pagination: { page: number; totalPage: number };
}

async function listReservationsForListing(listingId: string, status: string): Promise<RawReservation[]> {
  const out: RawReservation[] = [];
  let page = 1;
  for (;;) {
    const res = (await vrPlatformFetchRaw("/reservations", {
      listingId,
      date: DATE_RANGE,
      dateField: "intersection",
      status,
      includeLines: "true",
      limit: "250",
      page: String(page),
    })) as ReservationsResponse;
    out.push(...res.data);
    if (page >= res.pagination.totalPage) break;
    page++;
  }
  return out;
}

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  try {
    const [allProperties, vrListings, accountByLineType] = await Promise.all([
      listPropertiesForFinance(),
      listAllVrListings(),
      getAccountByLineType(),
    ]);

    const vrListingsByName = new Map(vrListings.map((l) => [normalizeRef(l.title || l.name || ""), l]));

    const propertiesOut = await Promise.all(
      REFERENCE_QUERIES.map(async (refQuery) => {
        const property = allProperties.find((p) => normalizeRef(p.reference) === normalizeRef(refQuery));
        if (!property) return { referenceQuery: refQuery, error: "Bien introuvable en base M.G.B." };

        const references = [property.reference, ...property.extraVrplatformReferences];
        const resolved = references.map((ref) => vrListingsByName.get(normalizeRef(ref))).filter((l): l is VrListing => !!l);
        const notFoundReferences = references.filter((ref) => !vrListingsByName.has(normalizeRef(ref)));

        const allReservations = (
          await Promise.all(
            resolved.flatMap((l) => STATUSES.map((status) => listReservationsForListing(l.id, status)))
          )
        ).flat();

        const detailed = allReservations.map((r) => {
          let rentsCents = 0;
          let channelFeesCents = 0;
          let cityTaxCents = 0;
          const lineDetail = (r.lines ?? []).map((line) => {
            const account = line.type ? accountByLineType.get(line.type) ?? null : null;
            if (account === RENTS_ACCOUNT) rentsCents += line.amount ?? 0;
            else if (account && CHANNEL_COMMISSION_ACCOUNTS.has(account)) channelFeesCents += Math.abs(line.amount ?? 0);
            else if (account === CITY_TAX_ACCOUNT) cityTaxCents += Math.abs(line.amount ?? 0);
            return { type: line.type, account, amountCents: line.amount };
          });
          return {
            checkIn: r.checkIn,
            checkOut: r.checkOut,
            status: r.status,
            guestName: r.guestName,
            bookingPlatform: r.bookingPlatform,
            confirmationCode: r.confirmationCode,
            pmsReferenceCode: r.pmsReferenceCode,
            rentsCents,
            channelFeesCents,
            cityTaxCents,
            netRevenueCents: rentsCents - channelFeesCents,
            lineDetail,
          };
        });

        return {
          reference: property.reference,
          name: property.name,
          resolvedListingIds: resolved.map((l) => l.id),
          notFoundReferences,
          reservationCount: detailed.length,
          reservations: detailed,
        };
      })
    );

    return NextResponse.json(
      { dateRange: DATE_RANGE, properties: propertiesOut },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur VRPlatform inconnue." }, { status: 502 });
  }
}
