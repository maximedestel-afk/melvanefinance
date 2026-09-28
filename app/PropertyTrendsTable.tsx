"use client";

import { useMemo, useState } from "react";
import type { RentType } from "@/lib/types";

type SortKey =
  | "reference"
  | "sampleSize"
  | "medianLeadTimeDays"
  | "avgLengthOfStayNights"
  | "under7Percent"
  | "from7To15Percent"
  | "over15Percent";

const RENT_TYPE_LABELS: Record<RentType, string> = {
  fixe: "Fixe",
  variable: "Variable",
  fixe_variable: "Fixe + variable",
};

const RENT_TYPE_SHORT_LABELS: Record<RentType, string> = {
  fixe: "F",
  variable: "V",
  fixe_variable: "F+V",
};

interface PropertyOption {
  id: string;
  reference: string;
  tags: string[];
  rentType: RentType | null;
  ownerEmail: string | null;
}

interface TrendsRow {
  propertyId: string;
  reference: string;
  rentType: RentType | null;
  notFoundReferences: string[];
  sampleSize: number;
  medianLeadTimeDays: number | null;
  avgLengthOfStayNights: number | null;
  under7Percent: number | null;
  from7To15Percent: number | null;
  over15Percent: number | null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function Days({ value }: { value: number | null }) {
  if (value == null) return <span className="text-[#6e6e73]">—</span>;
  return <span>{Math.round(value)} j</span>;
}

function Nights({ value }: { value: number | null }) {
  if (value == null) return <span className="text-[#6e6e73]">—</span>;
  return <span>{value.toFixed(1)} nuits</span>;
}

function Pct({ value }: { value: number | null }) {
  if (value == null) return <span className="text-[#6e6e73]">—</span>;
  return <span>{Math.round(value)}%</span>;
}

function SortHeader({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
  align = "right",
  title,
  narrow = false,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  direction: "asc" | "desc";
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
  title?: string;
  narrow?: boolean;
}) {
  const isActive = activeKey === sortKey;
  return (
    <th className={`py-1.5 px-2 first:pl-3 last:pr-3 ${align === "right" ? "text-right" : "text-left"}`} title={title}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 text-[11px] font-medium transition ${
          align === "right" ? "flex-row-reverse" : ""
        } ${narrow ? "w-16 whitespace-normal text-left leading-tight" : ""} ${
          isActive ? "text-[#1d1d1f]" : "text-[#86868b] hover:text-[#1d1d1f]"
        }`}
      >
        {label}
        {isActive && <span aria-hidden>{direction === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}

/** Onglet "Tendances" — fenêtre de réservation médiane, durée moyenne de
 * séjour et répartition par délai de réservation (<7j / 7-15j / >15j), une
 * ligne par bien, sur les 12 derniers mois glissants (indépendant de toute
 * période sélectionnée — voir getPortfolioBookingWindowStats). Mêmes
 * filtres bien/modèle/tags/propriétaire que l'onglet Owner. */
export function PropertyTrendsTable({ properties: unsortedProperties }: { properties: PropertyOption[] }) {
  const allProperties = useMemo(
    () => [...unsortedProperties].sort((a, b) => a.reference.localeCompare(b.reference, "fr")),
    [unsortedProperties]
  );
  const allTags = useMemo(
    () => Array.from(new Set(allProperties.flatMap((p) => p.tags))).sort((a, b) => a.localeCompare(b, "fr")),
    [allProperties]
  );
  const allOwners = useMemo(
    () =>
      Array.from(new Set(allProperties.map((p) => p.ownerEmail).filter((e): e is string => e != null))).sort((a, b) =>
        a.localeCompare(b, "fr")
      ),
    [allProperties]
  );
  const rentTypeByPropertyId = useMemo(() => new Map(allProperties.map((p) => [p.id, p.rentType])), [allProperties]);

  const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>(() => allProperties.map((p) => p.id));
  const [showProperties, setShowProperties] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedRentTypes, setSelectedRentTypes] = useState<RentType[]>([]);
  const [selectedOwner, setSelectedOwner] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("reference");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [rows, setRows] = useState<TrendsRow[] | null>(null);
  const [removedRowIds, setRemovedRowIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matchingProperties = useMemo(() => {
    return allProperties.filter((p) => {
      const isSelected = selectedPropertyIds.includes(p.id);
      const matchesTags = selectedTags.length === 0 || p.tags.some((t) => selectedTags.includes(t));
      const matchesRentType = selectedRentTypes.length === 0 || (p.rentType != null && selectedRentTypes.includes(p.rentType));
      const matchesOwner = selectedOwner === "" || p.ownerEmail === selectedOwner;
      return isSelected && matchesTags && matchesRentType && matchesOwner;
    });
  }, [allProperties, selectedPropertyIds, selectedTags, selectedRentTypes, selectedOwner]);

  function toggleProperty(id: string) {
    setSelectedPropertyIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  function toggleTag(tag: string) {
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  function toggleRentType(rentType: RentType) {
    setSelectedRentTypes((prev) => (prev.includes(rentType) ? prev.filter((t) => t !== rentType) : [...prev, rentType]));
  }

  async function load() {
    if (matchingProperties.length === 0) {
      setError("Aucun bien ne correspond aux filtres.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ propertyIds: matchingProperties.map((p) => p.id).join(",") });
      const res = await fetch(`/api/finance/booking-window-portfolio?${params.toString()}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setRows(null);
      } else {
        setRows(
          data.properties.map(
            (p: {
              propertyId: string;
              reference: string;
              notFoundReferences: string[];
              sampleSize: number;
              medianLeadTimeDays: number | null;
              avgLengthOfStayNights: number | null;
              leadTimeBuckets: { under7Percent: number | null; from7To15Percent: number | null; over15Percent: number | null };
            }) => ({
              propertyId: p.propertyId,
              reference: p.reference,
              rentType: rentTypeByPropertyId.get(p.propertyId) ?? null,
              notFoundReferences: p.notFoundReferences,
              sampleSize: p.sampleSize,
              medianLeadTimeDays: p.medianLeadTimeDays,
              avgLengthOfStayNights: p.avgLengthOfStayNights,
              under7Percent: p.leadTimeBuckets.under7Percent,
              from7To15Percent: p.leadTimeBuckets.from7To15Percent,
              over15Percent: p.leadTimeBuckets.over15Percent,
            })
          )
        );
        setRemovedRowIds(new Set());
      }
    } catch {
      setError("Impossible de charger les tendances de réservation.");
    } finally {
      setLoading(false);
    }
  }

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDirection(key === "reference" ? "asc" : "desc");
    }
  }

  function removeRow(propertyId: string) {
    setRemovedRowIds((prev) => new Set(prev).add(propertyId));
  }

  const sortedRows = rows
    ? [...rows]
        .filter((r) => !removedRowIds.has(r.propertyId))
        .sort((a, b) => {
          let cmp: number;
          if (sortKey === "reference") cmp = a.reference.localeCompare(b.reference, "fr");
          else cmp = (a[sortKey] ?? -1) - (b[sortKey] ?? -1);
          return direction === "asc" ? cmp : -cmp;
        })
    : null;

  const totals = sortedRows
    ? {
        sampleSize: sortedRows.reduce((sum, r) => sum + r.sampleSize, 0),
        medianLeadTimeDays: median(sortedRows.map((r) => r.medianLeadTimeDays).filter((v): v is number => v != null)),
        avgLengthOfStayNights: average(sortedRows.map((r) => r.avgLengthOfStayNights).filter((v): v is number => v != null)),
        under7Percent: average(sortedRows.map((r) => r.under7Percent).filter((v): v is number => v != null)),
        from7To15Percent: average(sortedRows.map((r) => r.from7To15Percent).filter((v): v is number => v != null)),
        over15Percent: average(sortedRows.map((r) => r.over15Percent).filter((v): v is number => v != null)),
      }
    : null;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowProperties((v) => !v)}
            className="flex items-center gap-2 rounded-[10px] border-2 border-[#0071e3] bg-white px-3 py-2 text-[13px] font-medium text-[#0071e3] transition hover:bg-[#0071e3]/5"
          >
            🏠 Choisir les biens ({selectedPropertyIds.length}/{allProperties.length})
            <span aria-hidden className={`transition-transform ${showProperties ? "rotate-180" : ""}`}>
              ▾
            </span>
          </button>
          <span className="rounded-full bg-[#0071e3]/10 px-3 py-1.5 text-[13px] font-semibold text-[#0071e3]">
            {matchingProperties.length} bien{matchingProperties.length !== 1 ? "s" : ""} sélectionné
            {matchingProperties.length !== 1 ? "s" : ""} (après filtres)
          </span>
          <button type="button" onClick={load} disabled={loading} className="btn-secondary btn-sm">
            {loading ? "Chargement…" : rows ? "Actualiser" : "Charger"}
          </button>
        </div>
        {showProperties && (
          <>
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSelectedPropertyIds(allProperties.map((p) => p.id))}
                className="text-[12px] font-medium text-[#0071e3] hover:underline"
              >
                Tout sélectionner
              </button>
              <button
                type="button"
                onClick={() => setSelectedPropertyIds([])}
                className="text-[12px] font-medium text-[#0071e3] hover:underline"
              >
                Tout désélectionner
              </button>
            </div>
            <div className="mt-1 grid max-h-56 grid-cols-2 gap-x-4 gap-y-1 overflow-y-auto rounded-[10px] border border-black/10 bg-white p-3 sm:grid-cols-3 md:grid-cols-4">
              {allProperties.map((p) => (
                <label key={p.id} className="flex items-center gap-1.5 text-[13px] text-[#1d1d1f]">
                  <input
                    type="checkbox"
                    checked={selectedPropertyIds.includes(p.id)}
                    onChange={() => toggleProperty(p.id)}
                    className="h-3.5 w-3.5 rounded border-black/20 text-[#0071e3] focus:ring-[#0071e3]/40"
                  />
                  {p.reference}
                </label>
              ))}
            </div>
          </>
        )}
      </div>

      {allOwners.length > 0 && (
        <div>
          <label className="field-label" htmlFor="trends-owner-filter">
            Propriétaire
          </label>
          <select
            id="trends-owner-filter"
            value={selectedOwner}
            onChange={(e) => setSelectedOwner(e.target.value)}
            className="mt-1 rounded-[10px] border border-black/10 bg-white px-3 py-2 text-[14px] text-[#1d1d1f] shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus:border-[#0071e3] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
          >
            <option value="">Tous les propriétaires</option>
            {allOwners.map((email) => (
              <option key={email} value={email}>
                {email}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <span className="field-label">Modèle de rémunération</span>
        <div className="mt-1 flex flex-wrap gap-1">
          {(Object.keys(RENT_TYPE_LABELS) as RentType[]).map((rentType) => {
            const active = selectedRentTypes.includes(rentType);
            return (
              <button
                key={rentType}
                type="button"
                onClick={() => toggleRentType(rentType)}
                className={`rounded-full border px-2.5 py-1 text-[13px] font-medium transition ${
                  active
                    ? "border-[#0071e3] bg-[#0071e3] text-white"
                    : "border-black/10 bg-white text-[#1d1d1f] hover:bg-black/[0.04]"
                }`}
              >
                {RENT_TYPE_LABELS[rentType]}
              </button>
            );
          })}
        </div>
      </div>

      {allTags.length > 0 && (
        <div>
          <span className="field-label">Tags</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {allTags.map((tag) => {
              const active = selectedTags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={`rounded-full border px-2.5 py-1 text-[13px] font-medium transition ${
                    active
                      ? "border-[#0071e3] bg-[#0071e3] text-white"
                      : "border-black/10 bg-white text-[#1d1d1f] hover:bg-black/[0.04]"
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {error && <p className="text-[13px] text-red-600">{error}</p>}

      {sortedRows && totals && !loading && !error && (
        <div className="space-y-2">
          <p className="text-[13px] text-[#6e6e73]">
            Réservations faites au cours des 12 derniers mois glissants, y compris celles dont le check-in est encore
            à venir.
          </p>
          {removedRowIds.size > 0 && (
            <p className="text-[13px] text-[#6e6e73]">
              {removedRowIds.size} bien{removedRowIds.size !== 1 ? "s" : ""} masqué{removedRowIds.size !== 1 ? "s" : ""} de cette liste ·{" "}
              <button type="button" onClick={() => setRemovedRowIds(new Set())} className="font-medium text-[#0071e3] hover:underline">
                Réafficher
              </button>
            </p>
          )}
          <div className="overflow-hidden rounded-[14px] border border-black/[0.06]">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-black/[0.08] bg-black/[0.015]">
                    <SortHeader label="Bien" sortKey="reference" activeKey={sortKey} direction={direction} onSort={handleSort} align="left" />
                    <th className="py-1.5 px-2 text-left text-[11px] font-medium text-[#86868b]">Modèle</th>
                    <SortHeader
                      label="Résa (12 mois)"
                      sortKey="sampleSize"
                      activeKey={sortKey}
                      direction={direction}
                      onSort={handleSort}
                      title="Nombre de réservations faites au cours des 12 derniers mois"
                      narrow
                    />
                    <SortHeader
                      label="Fenêtre médiane"
                      sortKey="medianLeadTimeDays"
                      activeKey={sortKey}
                      direction={direction}
                      onSort={handleSort}
                      title="Médiane du nombre de jours entre la réservation et le check-in"
                      narrow
                    />
                    <SortHeader
                      label="Séjour moyen"
                      sortKey="avgLengthOfStayNights"
                      activeKey={sortKey}
                      direction={direction}
                      onSort={handleSort}
                      narrow
                    />
                    <SortHeader
                      label="< 7 j"
                      sortKey="under7Percent"
                      activeKey={sortKey}
                      direction={direction}
                      onSort={handleSort}
                      title="Part des réservations faites moins de 7 jours avant le check-in"
                    />
                    <SortHeader
                      label="7-15 j"
                      sortKey="from7To15Percent"
                      activeKey={sortKey}
                      direction={direction}
                      onSort={handleSort}
                      title="Part des réservations faites entre 7 et 15 jours avant le check-in"
                    />
                    <SortHeader
                      label="> 15 j"
                      sortKey="over15Percent"
                      activeKey={sortKey}
                      direction={direction}
                      onSort={handleSort}
                      title="Part des réservations faites plus de 15 jours avant le check-in"
                    />
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row, rowIndex) => (
                    <tr
                      key={row.propertyId}
                      className={`border-b border-black/[0.04] transition-colors last:border-b-0 hover:bg-[#dceafb] ${
                        rowIndex % 2 === 0 ? "bg-white" : "bg-[#f0f6fd]"
                      }`}
                    >
                      <td className="py-1.5 pl-3 pr-2 text-[#1d1d1f]">
                        <button
                          type="button"
                          onClick={() => removeRow(row.propertyId)}
                          title="Retirer ce bien de la liste"
                          className="mr-1.5 text-[#c7c7cc] transition hover:text-red-600"
                        >
                          ✕
                        </button>
                        <span className="font-medium">{row.reference}</span>
                        {row.notFoundReferences.length > 0 && (
                          <span
                            title={`Référence VRPlatform introuvable : ${row.notFoundReferences.join(", ")}`}
                            className="ml-1.5 text-amber-600"
                          >
                            ⚠
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 px-2 text-left text-[#1d1d1f]" title={row.rentType != null ? RENT_TYPE_LABELS[row.rentType] : undefined}>
                        {row.rentType != null ? RENT_TYPE_SHORT_LABELS[row.rentType] : "—"}
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">{row.sampleSize}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">
                        <Days value={row.medianLeadTimeDays} />
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">
                        <Nights value={row.avgLengthOfStayNights} />
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">
                        <Pct value={row.under7Percent} />
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">
                        <Pct value={row.from7To15Percent} />
                      </td>
                      <td className="py-1.5 pl-2 pr-3 text-right tabular-nums text-[#1d1d1f]">
                        <Pct value={row.over15Percent} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-black/[0.08] bg-black/[0.015] font-semibold text-[#1d1d1f]">
                    <td className="py-1.5 pl-3 pr-2">Total ({sortedRows.length} bien{sortedRows.length !== 1 ? "s" : ""})</td>
                    <td className="py-1.5 px-2"></td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{totals.sampleSize}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">
                      <Days value={totals.medianLeadTimeDays} />
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums">
                      <Nights value={totals.avgLengthOfStayNights} />
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums">
                      <Pct value={totals.under7Percent} />
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums">
                      <Pct value={totals.from7To15Percent} />
                    </td>
                    <td className="py-1.5 pl-2 pr-3 text-right tabular-nums">
                      <Pct value={totals.over15Percent} />
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {!rows && !loading && !error && (
        <p className="text-[13px] text-[#6e6e73]">Filtre par bien/modèle/tag/propriétaire si besoin, puis charge les données.</p>
      )}
    </div>
  );
}
