// Intégration Monday.com en lecture seule pour afficher le tableau « Comm
// Sharing » (facturation Sweep It) directement dans l'app, au lieu de
// l'exporter/importer à la main via le Convertisseur CSV (voir
// CsvConverterTable.tsx, qui lit le même tableau mais depuis un export
// Excel/CSV collé par l'utilisateur). Un nouveau tableau Monday est créé
// chaque mois ("Oct 26", "Sep 26"...), d'où la recherche par nom plutôt
// qu'un ID fixe.

const API_URL = "https://api.monday.com/v2";

// Workspace "PARTENAIRES" où vivent les tableaux mensuels Comm Sharing —
// limite la recherche par nom à ce workspace plutôt qu'à tout le compte.
const PARTENAIRES_WORKSPACE_ID = 5442937;

const ENGLISH_MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function isMondayConfigured(): boolean {
  return !!process.env.MONDAY_API_TOKEN;
}

async function mondayFetch<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) throw new Error("Monday.com n'est pas configuré (MONDAY_API_TOKEN manquant).");

  const response = await fetch(API_URL, {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json", "API-Version": "2024-10" },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Monday.com a répondu ${response.status}.`);
  const json = (await response.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors && json.errors.length > 0) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  return json.data as T;
}

/** "Oct 26" pour month=10, year=2026 — convention de nommage des tableaux
 * Comm Sharing mensuels observée sur le compte Monday. */
export function commSharingBoardLabel(year: number, month: number): string {
  return `${ENGLISH_MONTH_ABBR[month - 1]} ${String(year).slice(-2)}`;
}

interface BoardsResponse {
  boards: { id: string; name: string }[] | null;
}

/** Cherche, dans le workspace PARTENAIRES, le tableau dont le nom
 * correspond exactement (insensible à la casse) au mois demandé. Renvoie
 * null si aucun tableau de ce mois n'existe encore. */
async function findCommSharingBoardId(year: number, month: number): Promise<string | null> {
  const label = commSharingBoardLabel(year, month).toLowerCase();
  const data = await mondayFetch<BoardsResponse>(
    `query($workspaceIds: [ID!]) {
      boards(workspace_ids: $workspaceIds, limit: 100, state: active) { id name }
    }`,
    { workspaceIds: [PARTENAIRES_WORKSPACE_ID] }
  );
  const match = (data.boards ?? []).find((b) => b.name.trim().toLowerCase() === label);
  return match?.id ?? null;
}

export interface CommSharingRow {
  id: string;
  name: string;
  date: string | null;
  flat: string | null;
  price: number | null;
  label: string | null;
  prestataire: string | null;
  billId: string | null;
  billToOwner: string | null;
}

interface ColumnValue {
  id: string;
  text: string | null;
}
interface ItemsPage {
  cursor: string | null;
  items: { id: string; name: string; column_values: ColumnValue[] }[];
}
interface BoardItemsResponse {
  boards: { groups: { items_page: ItemsPage }[] }[] | null;
}

const COMM_SHARING_GROUP_ID = "topics";
const COLUMN_IDS = [
  "date4",
  "dropdown_mkykc1jr",
  "numeric_mkyk8m24",
  "color_mm82d1af",
  "dropdown_mm82vtph",
  "pulse_id_mm82zajn",
  "dropdown_mm82az3r",
];

function toRow(item: { id: string; name: string; column_values: ColumnValue[] }): CommSharingRow {
  const byId = new Map(item.column_values.map((c) => [c.id, c.text]));
  const priceText = byId.get("numeric_mkyk8m24");
  const price = priceText ? Number.parseFloat(priceText.replace(",", ".")) : null;
  return {
    id: item.id,
    name: item.name,
    date: byId.get("date4") ?? null,
    flat: byId.get("dropdown_mkykc1jr") ?? null,
    price: price != null && Number.isFinite(price) ? price : null,
    label: byId.get("color_mm82d1af") ?? null,
    prestataire: byId.get("dropdown_mm82vtph") ?? null,
    billId: byId.get("pulse_id_mm82zajn") ?? null,
    billToOwner: byId.get("dropdown_mm82az3r") ?? null,
  };
}

/** Lignes du groupe "Comm Sharing" du tableau Monday du mois demandé — null
 * si aucun tableau de ce mois n'existe (pas encore créé côté Monday). */
export async function getCommSharingRows(year: number, month: number): Promise<CommSharingRow[] | null> {
  const boardId = await findCommSharingBoardId(year, month);
  if (!boardId) return null;

  const rows: CommSharingRow[] = [];
  let cursor: string | null = null;
  for (;;) {
    const data: BoardItemsResponse = await mondayFetch<BoardItemsResponse>(
      `query($boardId: ID!, $columnIds: [String!], $cursor: String, $groupId: [String!]) {
        boards(ids: [$boardId]) {
          groups(ids: $groupId) {
            items_page(limit: 200, cursor: $cursor) {
              cursor
              items { id name column_values(ids: $columnIds) { id text } }
            }
          }
        }
      }`,
      { boardId, columnIds: COLUMN_IDS, cursor, groupId: [COMM_SHARING_GROUP_ID] }
    );
    const page = data.boards?.[0]?.groups?.[0]?.items_page;
    if (!page) break;
    rows.push(...page.items.map(toRow));
    if (!page.cursor) break;
    cursor = page.cursor;
  }
  return rows;
}
