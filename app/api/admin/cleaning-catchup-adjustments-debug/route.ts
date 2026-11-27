import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { getAlreadyAdjustedReservationIds, isVrPlatformConfigured } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";

// TEMPORAIRE — la colonne "Déjà dans VR" de l'onglet Rattrapage Ménage ne
// reconnaît aucune ligne pourtant déjà ajustée dans VRPlatform (ex: résa
// 69ba43db-eeed-4d33-aeef-522998701dae / confirmationCode 5300993280, dont
// on a confirmé à la main les 2 Adjustments "Commission ménage" / "Rattrapage
// commission ménage"). Ce diagnostic appelle getAlreadyAdjustedReservationIds
// (la même fonction utilisée par la route réelle) ET dump la réponse brute de
// GET /reservations/{id} pour voir où ça casse : erreur réseau, champ
// "adjustments" vide/différent, ou texte de description qui ne matche pas
// le filtre ("ménage" + confirmationCode).
const API_BASE_URL = "https://api.vrplatform.app";
const RESERVATION_ID = "69ba43db-eeed-4d33-aeef-522998701dae";
const CONFIRMATION_CODE = "5300993280";

async function vrPlatformFetchRaw(path: string): Promise<unknown> {
  const apiKey = process.env.VRPLATFORM_API_KEY;
  const teamId = process.env.VRPLATFORM_TEAM_ID;
  if (!apiKey || !teamId) throw new Error("VRPlatform n'est pas configuré.");
  const url = new URL(path, API_BASE_URL);
  const response = await fetch(url, { headers: { "x-api-key": apiKey, "x-team-id": teamId }, cache: "no-store" });
  const text = await response.text();
  if (!response.ok) throw new Error(`VRPlatform ${response.status}: ${text}`);
  return JSON.parse(text);
}

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });
  if (!isVrPlatformConfigured()) {
    return NextResponse.json({ error: "VRPlatform n'est pas configuré sur ce déploiement." }, { status: 500 });
  }

  const result: Record<string, unknown> = {};

  try {
    const raw = (await vrPlatformFetchRaw(`/reservations/${RESERVATION_ID}`)) as {
      adjustments?: { id: string; description: string | null; amount: number }[];
    };
    result.rawAdjustments = raw.adjustments ?? null;
    result.rawAdjustmentsType = Array.isArray(raw.adjustments) ? "array" : typeof raw.adjustments;
  } catch (err) {
    result.rawFetchError = err instanceof Error ? err.message : String(err);
  }

  // Les 2 lignes vues dans l'UI VRPlatform (catégorie "Management Fee
  // Rebate") n'apparaissent pas dans /reservations/{id}.adjustments — ce
  // sont peut-être de vraies écritures de journal (comme Management
  // Commission@25% etc), mais SANS reservationId associé (référence au
  // confirmationCode seulement en texte libre dans la description), donc
  // invisibles dans la recherche précédente qui filtrait par reservationId.
  // On teste ici /reports/journal-entries?search=<confirmationCode>.
  try {
    const searchResult = await vrPlatformFetchRaw(
      `/reports/journal-entries?search=${encodeURIComponent(CONFIRMATION_CODE)}&limit=50&page=1`
    );
    result.journalEntriesSearchResult = searchResult;
  } catch (err) {
    result.journalEntriesSearchError = err instanceof Error ? err.message : String(err);
  }

  try {
    const alreadyAdjusted = await getAlreadyAdjustedReservationIds([
      { reservationId: RESERVATION_ID, confirmationCode: CONFIRMATION_CODE },
    ]);
    result.getAlreadyAdjustedReservationIdsResult = Array.from(alreadyAdjusted);
  } catch (err) {
    result.libFunctionError = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json(result, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
