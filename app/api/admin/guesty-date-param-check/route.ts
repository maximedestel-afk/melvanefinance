import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";

export const dynamic = "force-dynamic";

// TEMPORAIRE — getAllGuestyReservationsRaw() paginele compte entier sans
// borne de date et ne retourne que ~522 réservations, dont toutes celles
// avec check-in avant "aujourd'hui" (2026-10-14) sont absentes — fort indice
// que l'API Guesty /v1/reservations, sans filtre de date explicite, ne
// renvoie que les réservations à venir. Cette route teste plusieurs noms de
// paramètres de date candidats pour retrouver une réservation connue comme
// manquante (BC-0myz9VOMV, check-in 2026-10-02) et voir lequel fonctionne,
// avant de corriger getAllGuestyReservationsRaw.

const API_BASE_URL = "https://open-api.guesty.com/v1";
const KNOWN_MISSING_CONFIRMATION_CODE = "BC-0myz9VOMV";

// Duplique l'auth de lib/guesty.ts (non exportée) pour ce test isolé.
let cachedToken: { value: string; expiresAt: number } | null = null;
async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  const clientId = process.env.GUESTY_CLIENT_ID;
  const clientSecret = process.env.GUESTY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Guesty non configuré.");
  const res = await fetch("https://open-api.guesty.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret, scope: "open-api" }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Auth Guesty refusée (${res.status}).`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 300) * 1000 };
  return cachedToken.value;
}

async function tryCandidate(label: string, extraParams: Record<string, string>) {
  const token = await getToken();
  const url = new URL(`${API_BASE_URL}/reservations`);
  url.searchParams.set("limit", "100");
  url.searchParams.set("skip", "0");
  url.searchParams.set("fields", "listingId status checkIn checkOut confirmationCode");
  for (const [k, v] of Object.entries(extraParams)) url.searchParams.set(k, v);

  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!res.ok) {
    return { label, params: extraParams, httpStatus: res.status, ok: false, error: await res.text().catch(() => "") };
  }
  const data = (await res.json()) as { results: Record<string, unknown>[]; count: number };
  const foundKnownMissing = data.results.some((r) => r.confirmationCode === KNOWN_MISSING_CONFIRMATION_CODE);
  return {
    label,
    params: extraParams,
    httpStatus: res.status,
    ok: true,
    totalCount: data.count,
    firstPageSize: data.results.length,
    foundKnownMissingReservation: foundKnownMissing,
    sampleCheckIns: data.results.slice(0, 5).map((r) => r.checkIn),
  };
}

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  const candidates: { label: string; params: Record<string, string> }[] = [
    { label: "baseline (no date params)", params: {} },
    { label: "checkInDateFrom/To", params: { checkInDateFrom: "2026-10-01", checkInDateTo: "2026-10-31" } },
    { label: "checkOutDateFrom/To", params: { checkOutDateFrom: "2026-10-01", checkOutDateTo: "2026-10-31" } },
    { label: "fromDate/toDate", params: { fromDate: "2026-10-01", toDate: "2026-10-31" } },
    { label: "checkIn/checkOut range (dot-dot)", params: { checkIn: "2026-10-01...2026-10-31" } },
    {
      label: "filters JSON array (checkIn $gte/$lte)",
      params: {
        filters: JSON.stringify([
          { field: "checkIn", operator: "$gte", value: "2026-10-01" },
          { field: "checkIn", operator: "$lte", value: "2026-10-31" },
        ]),
      },
    },
  ];

  const results = [];
  for (const c of candidates) {
    try {
      results.push(await tryCandidate(c.label, c.params));
    } catch (err) {
      results.push({ label: c.label, params: c.params, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({ knownMissingConfirmationCode: KNOWN_MISSING_CONFIRMATION_CODE, results }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
