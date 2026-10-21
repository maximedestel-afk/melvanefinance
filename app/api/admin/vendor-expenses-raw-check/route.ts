import { NextResponse } from "next/server";
import { getCurrentProfile, listPropertiesForFinance } from "@/lib/queries";
import { isVrPlatformConfigured } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// TEMPORAIRE — diagnostic pour voir les champs BRUTS renvoyés par
// /reports/journal-entries sur le compte Housekeeping. getPortfolioExpenseEntriesByVendor
// (lib/vrplatform.ts) ne filtre que sur `description`, or l'utilisateur
// indique que le prestataire Sweepit est identifié par un email
// (contact@sweepit.fr), probablement dans un champ qu'on ne type/lit pas
// encore (supplier, vendor, contact...). Ce dump sert à retrouver le bon
// champ avant de corriger le filtre.
const HOUSEKEEPING_ACCOUNT_ID = "4c2860e2-0acc-4b22-b665-38005b8cd610";
const API_BASE_URL = "https://api.vrplatform.app";

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

interface VrPlatformListingOption {
  id: string;
  uniqueRef: string | null;
  name: string;
}
interface VrPlatformListingsResponse {
  data: VrPlatformListingOption[];
  pagination: { page: number; totalPage: number };
}

export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });
  if (!isVrPlatformConfigured()) {
    return NextResponse.json({ error: "VRPlatform n'est pas configuré sur ce déploiement." }, { status: 500 });
  }

  const searchParams = new URL(request.url).searchParams;
  const year = searchParams.get("year") ?? "2026";
  const month = searchParams.get("month") ?? "10";

  try {
    const properties = await listPropertiesForFinance();
    const allListings: VrPlatformListingOption[] = [];
    let page = 1;
    for (;;) {
      const res = (await vrPlatformFetchRaw("/listings", { status: "active", limit: "250", page: String(page) })) as VrPlatformListingsResponse;
      allListings.push(...res.data);
      if (page >= res.pagination.totalPage) break;
      page++;
    }
    const listingsByName = new Map(allListings.map((l) => [l.name.trim().toLowerCase(), l]));

    const referenceToListingId = new Map<string, string>();
    for (const p of properties) {
      for (const ref of [p.reference, ...p.extraVrplatformReferences]) {
        const listing = listingsByName.get(ref.trim().toLowerCase());
        if (listing) referenceToListingId.set(ref, listing.id);
      }
    }

    const matches: unknown[] = [];
    for (const [reference, listingId] of referenceToListingId) {
      let entriesPage = 1;
      for (;;) {
        const res = (await vrPlatformFetchRaw("/reports/journal-entries", {
          accountIds: HOUSEKEEPING_ACCOUNT_ID,
          listingIds: listingId,
          date: year,
          status: "active",
          limit: "250",
          page: String(entriesPage),
        })) as { data: Record<string, unknown>[]; pagination: { page: number; totalPage: number } };
        for (const entry of res.data) {
          const txnAt = typeof entry.txnAt === "string" ? entry.txnAt : "";
          if (txnAt.slice(5, 7) !== String(month).padStart(2, "0")) continue;
          matches.push({ reference, ...entry });
        }
        if (entriesPage >= res.pagination.totalPage) break;
        entriesPage++;
      }
      if (matches.length >= 30) break;
    }

    return NextResponse.json(
      { year, month, listingCount: referenceToListingId.size, sampleCount: matches.length, samples: matches.slice(0, 30) },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur VRPlatform inconnue." },
      { status: 502 }
    );
  }
}
