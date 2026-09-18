// Intégration Guesty (Open API) — pour des données sur les biens que
// VRPlatform n'expose pas (ex: prix du ménage, équipements, chambres...).
// Authentification OAuth2 client_credentials, jamais depuis le client.

const API_BASE_URL = "https://open-api.guesty.com/v1";
const TOKEN_URL = "https://open-api.guesty.com/oauth2/token";

let cachedToken: { value: string; expiresAt: number } | null = null;

export function isGuestyConfigured(): boolean {
  return !!process.env.GUESTY_CLIENT_ID && !!process.env.GUESTY_CLIENT_SECRET;
}

async function getGuestyToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;

  const clientId = process.env.GUESTY_CLIENT_ID;
  const clientSecret = process.env.GUESTY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Guesty n'est pas configuré (GUESTY_CLIENT_ID / GUESTY_CLIENT_SECRET manquants).");
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "open-api",
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Guesty a refusé l'authentification (${response.status}).`);
  }
  const data = (await response.json()) as { access_token: string; expires_in: number };
  // Marge de 60s avant expiration pour éviter d'utiliser un token tout juste périmé.
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cachedToken.value;
}

export interface GuestyAddress {
  full: string | null;
  lng: number | null;
  lat: number | null;
  street: string | null;
  city: string | null;
  country: string | null;
}

export interface GuestyPrices {
  basePrice: number | null;
  weekendBasePrice: number | null;
  extraPersonFee: number | null;
  guestsIncludedInRegularFee: number | null;
  securityDepositFee: number | null;
  cleaningFee: number | null;
  currency: string | null;
}

export interface GuestyListing {
  _id: string;
  title: string | null;
  nickname: string | null;
  tags: string[];
  isListed: boolean;
  active: boolean;
  propertyType: string | null;
  roomType: string | null;
  bedType: string | null;
  accommodates: number | null;
  bedrooms: number | null;
  areaSquareFeet: number | null;
  address: GuestyAddress | null;
  timezone: string | null;
  defaultCheckInTime: string | null;
  defaultCheckOutTime: string | null;
  amenities: string[];
  amenitiesNotIncluded: string[];
  terms: { minNights: number | null; maxNights: number | null; cancellation: string | null } | null;
  prices: GuestyPrices | null;
  cleaning: { defaultCleaningTime: string | null; instructions: string | null } | null;
  cleaningStatus: { value: string | null; updatedAt: string | null } | null;
  customFields: Record<string, unknown>;
}

/** Objet listing complet d'un bien Guesty. Le bien est identifié par son ID
 * Guesty natif — pour un listing VRPlatform, c'est son champ `uniqueRef`
 * (VRPlatform passe par Guesty comme PMS sous-jacente). Passer `fields`
 * pour ne récupérer que certains champs (ex: ["title", "prices"]) et
 * réduire la charge de réponse. */
export async function getGuestyListing(guestyListingId: string, fields?: string[]): Promise<GuestyListing> {
  const token = await getGuestyToken();
  const url = new URL(`${API_BASE_URL}/listings/${guestyListingId}`);
  if (fields && fields.length > 0) url.searchParams.set("fields", fields.join(" "));

  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Guesty a répondu ${response.status} pour le listing ${guestyListingId}.`);
  }
  return response.json() as Promise<GuestyListing>;
}
