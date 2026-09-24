import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listOwnerProperties } from "@/lib/queries";
import { getGuestyListingIdForReference } from "@/lib/vrplatform";
import { getGuestyCalendarMonth } from "@/lib/guesty";

export const dynamic = "force-dynamic";

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Calendrier jour par jour d'un bien pour un mois donné — réservé aux
 * propriétaires authentifiés, et uniquement pour un bien qu'ils possèdent
 * (vérifié via listOwnerProperties, jamais un propertyId de confiance côté
 * client). Lecture seule, comme le reste de l'espace propriétaire. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const url = new URL(request.url);
  const propertyId = url.searchParams.get("propertyId");
  const year = Number.parseInt(url.searchParams.get("year") ?? "", 10);
  const month = Number.parseInt(url.searchParams.get("month") ?? "", 10);
  if (!propertyId || !Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });
  }

  const ownedProperties = await listOwnerProperties(user.email);
  const property = ownedProperties.find((p) => p.id === propertyId);
  if (!property) return NextResponse.json({ error: "Bien non trouvé." }, { status: 403 });

  const guestyListingId = await getGuestyListingIdForReference(property.reference);
  if (!guestyListingId) {
    return NextResponse.json({ error: "Aucun listing Guesty trouvé pour ce bien." }, { status: 404 });
  }

  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = `${year}-${String(month).padStart(2, "0")}-${String(daysInMonth(year, month)).padStart(2, "0")}`;

  const days = await getGuestyCalendarMonth(guestyListingId, startDate, endDate);
  return NextResponse.json({ days }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
