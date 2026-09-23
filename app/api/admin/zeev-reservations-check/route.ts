import { NextResponse } from "next/server";
import { getCurrentProfile, listPropertiesForFinance } from "@/lib/queries";
import { getAllGuestyReservations } from "@/lib/guesty";

export const dynamic = "force-dynamic";

// TEMPORAIRE — diagnostic réservations manquantes dans VRPlatform pour les
// biens tagués "zeev", sur une période donnée. À retirer une fois
// l'investigation terminée (voir aussi lib/guesty.ts:getAllGuestyReservations).

const VR_API_BASE_URL = "https://api.vrplatform.app";
const PERIOD_START = "2026-09-25";
const PERIOD_END = "2027-04-15";

async function vrFetch<T>(path: string, query: Record<string, string>): Promise<T> {
  const apiKey = process.env.VRPLATFORM_API_KEY;
  const teamId = process.env.VRPLATFORM_TEAM_ID;
  if (!apiKey || !teamId) throw new Error("VRPlatform non configuré.");
  const url = new URL(path, VR_API_BASE_URL);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { "x-api-key": apiKey, "x-team-id": teamId }, cache: "no-store" });
  if (!res.ok) throw new Error(`VRPlatform ${res.status} sur ${path}`);
  return res.json() as Promise<T>;
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
    const res = await vrFetch<VrListingsResponse>("/listings", { status: "active", limit: "250", page: String(page) });
    out.push(...res.data);
    if (page >= res.pagination.totalPage) break;
    page++;
  }
  return out;
}

interface VrReservation {
  uniqueRef: string | null;
  shortRef: string | null;
  checkIn: string | null;
  checkOut: string | null;
  status: string;
}
interface VrReservationsResponse {
  data: VrReservation[];
  pagination: { page: number; totalPage: number };
}

async function listVrReservationsForListing(listingId: string): Promise<VrReservation[]> {
  const out: VrReservation[] = [];
  let page = 1;
  for (;;) {
    const res = await vrFetch<VrReservationsResponse>("/reservations", {
      listingId,
      date: `${PERIOD_START}...${PERIOD_END}`,
      dateField: "intersection",
      status: "booked",
      limit: "250",
      page: String(page),
    });
    out.push(...res.data);
    if (page >= res.pagination.totalPage) break;
    page++;
  }
  return out;
}

function overlapsPeriod(checkIn: string | null, checkOut: string | null): boolean {
  if (!checkIn || !checkOut) return false;
  return checkIn.slice(0, 10) < PERIOD_END && checkOut.slice(0, 10) > PERIOD_START;
}

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  const [allProperties, vrListings, allGuestyReservations] = await Promise.all([
    listPropertiesForFinance(),
    listAllVrListings(),
    getAllGuestyReservations(),
  ]);

  const zeevProperties = allProperties.filter((p) => p.tags.includes("zeev"));
  const vrListingsByName = new Map(vrListings.map((l) => [(l.title || l.name || "").trim().toLowerCase(), l]));

  const properties = await Promise.all(
    zeevProperties.map(async (property) => {
      const references = [property.reference, ...property.extraVrplatformReferences];
      const resolved = references
        .map((ref) => vrListingsByName.get(ref.trim().toLowerCase()))
        .filter((l): l is VrListing => !!l);
      const notFoundReferences = references.filter((ref) => !vrListingsByName.has(ref.trim().toLowerCase()));

      const guestyListingIds = resolved.map((l) => l.uniqueRef).filter((id): id is string => !!id);

      const vrReservations = (
        await Promise.all(resolved.map((l) => listVrReservationsForListing(l.id)))
      ).flat();
      const vrUniqueRefs = new Set(vrReservations.map((r) => r.uniqueRef).filter((r): r is string => !!r));

      const guestyMatches = allGuestyReservations.filter(
        (r) => guestyListingIds.includes(r.listingId) && overlapsPeriod(r.checkIn, r.checkOut)
      );

      const missing = guestyMatches.filter((r) => !vrUniqueRefs.has(r._id));

      return {
        reference: property.reference,
        name: property.name,
        vrListingIds: resolved.map((l) => l.id),
        guestyListingIds,
        notFoundReferences,
        totalGuestyReservations: guestyMatches.length,
        totalVrReservations: vrReservations.length,
        missing,
      };
    })
  );

  return NextResponse.json(
    { period: { start: PERIOD_START, end: PERIOD_END }, zeevPropertyCount: zeevProperties.length, properties },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
