import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { isVrPlatformConfigured } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// TEMPORAIRE — on cherche à savoir comment un rattrapage ménage déjà ajouté
// manuellement dans VRPlatform est enregistré (quel compte, quel format de
// description, rattaché via reservationId ou pas), pour construire une
// colonne "déjà ajouté ?" dans l'onglet Rattrapage Ménage. On part d'une
// résa dont l'utilisateur confirme avoir déjà fait l'ajout (confirmationCode
// "5300993280") : on la retrouve, puis on dump TOUTES les écritures de
// journal (tous comptes) rattachées à son listing sur une large période,
// filtrées à celles dont reservationId correspond.
const API_BASE_URL = "https://api.vrplatform.app";
const CONFIRMATION_CODE = "5300993280";

async function vrPlatformFetchRaw(path: string, query: Record<string, string>): Promise<unknown> {
  const apiKey = process.env.VRPLATFORM_API_KEY;
  const teamId = process.env.VRPLATFORM_TEAM_ID;
  if (!apiKey || !teamId) throw new Error("VRPlatform n'est pas configuré.");
  const url = new URL(path, API_BASE_URL);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { "x-api-key": apiKey, "x-team-id": teamId }, cache: "no-store" });
  if (!response.ok) throw new Error(`VRPlatform a répondu ${response.status} sur ${path} (${await response.text()})`);
  return response.json();
}

interface VrReservation {
  [key: string]: unknown;
  id: string;
  confirmationCode: string | null;
  checkIn: string | null;
  checkOut: string | null;
  listing?: { id: string; name: string | null } | null;
}
interface VrReservationsResponse {
  data: VrReservation[];
  pagination: { page: number; totalPage: number };
}

async function findReservationByConfirmationCode(code: string): Promise<VrReservation | null> {
  // Tentative directe : si l'API filtre réellement sur ce paramètre, une
  // seule page suffit.
  const direct = (await vrPlatformFetchRaw("/reservations", {
    confirmationCode: code,
    limit: "250",
    page: "1",
  })) as VrReservationsResponse;
  const directMatch = direct.data.find((r) => r.confirmationCode === code);
  if (directMatch) return directMatch;

  // Sinon, parcours large (toutes résas, tous statuts, large fenêtre de
  // dates autour d'aujourd'hui) en cherchant le confirmationCode côté
  // client — coûteux mais ponctuel.
  for (const status of ["booked", "canceled", "inactive"]) {
    let page = 1;
    for (;;) {
      const res = (await vrPlatformFetchRaw("/reservations", {
        date: "2025-01-01...2027-12-31",
        dateField: "intersection",
        status,
        limit: "250",
        page: String(page),
      })) as VrReservationsResponse;
      const match = res.data.find((r) => r.confirmationCode === code);
      if (match) return match;
      if (page >= res.pagination.totalPage) break;
      page++;
    }
  }
  return null;
}

interface VrJournalEntry {
  [key: string]: unknown;
  id: string;
  txnAt: string;
  description: string | null;
  centTotal: number;
  party: string | null;
  status: string;
  reservationId?: string | null;
  account?: { id: string; name: string } | null;
}
interface VrJournalEntriesResponse {
  data: VrJournalEntry[];
  pagination: { page: number; totalPage: number };
}

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });
  if (!isVrPlatformConfigured()) {
    return NextResponse.json({ error: "VRPlatform n'est pas configuré sur ce déploiement." }, { status: 500 });
  }

  try {
    const reservation = await findReservationByConfirmationCode(CONFIRMATION_CODE);
    if (!reservation) {
      return NextResponse.json({ error: `Réservation "${CONFIRMATION_CODE}" introuvable.` }, { status: 404 });
    }

    const listingId = reservation.listing?.id;
    if (!listingId) {
      return NextResponse.json({ error: "Réservation trouvée mais sans listing associé.", reservation }, { status: 500 });
    }

    const entries: VrJournalEntry[] = [];
    let page = 1;
    for (;;) {
      const res = (await vrPlatformFetchRaw("/reports/journal-entries", {
        listingIds: listingId,
        date: "2025-01-01...2027-12-31",
        status: "active",
        limit: "250",
        page: String(page),
      })) as VrJournalEntriesResponse;
      entries.push(...res.data);
      if (page >= res.pagination.totalPage) break;
      page++;
    }

    const matching = entries.filter((e) => e.reservationId === reservation.id);
    const otherEntriesSample = entries.filter((e) => e.reservationId !== reservation.id).slice(0, 10);

    return NextResponse.json(
      {
        reservation: {
          id: reservation.id,
          confirmationCode: reservation.confirmationCode,
          checkIn: reservation.checkIn,
          checkOut: reservation.checkOut,
          listingId,
          listingName: reservation.listing?.name ?? null,
        },
        totalJournalEntriesForListing: entries.length,
        matchingReservationEntries: matching,
        otherEntriesSample,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur VRPlatform inconnue." }, { status: 502 });
  }
}
