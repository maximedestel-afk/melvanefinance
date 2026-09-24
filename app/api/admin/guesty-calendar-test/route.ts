import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { getGuestyCalendarRaw } from "@/lib/guesty";

export const dynamic = "force-dynamic";

// TEMPORAIRE — inspecte la forme brute de la réponse calendrier Guesty pour
// un listing connu (71STMAR), avant de construire la vue calendrier de
// l'espace propriétaire. À retirer une fois la forme confirmée.
const TEST_GUESTY_LISTING_ID = "6a81f229ec5a2500124ec669"; // 71STMAR

export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  const url = new URL(request.url);
  const startDate = url.searchParams.get("start") ?? "2026-11-01";
  const endDate = url.searchParams.get("end") ?? "2026-11-10";

  try {
    const data = await getGuestyCalendarRaw(TEST_GUESTY_LISTING_ID, startDate, endDate);
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
