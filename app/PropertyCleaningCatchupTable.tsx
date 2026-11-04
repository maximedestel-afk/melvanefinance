"use client";

import { useMemo, useState } from "react";
import { formatEuros, MONTH_LABELS_SHORT } from "@/lib/format";
import type { RentType } from "@/lib/types";

interface PropertyOption {
  id: string;
  reference: string;
  tags: string[];
  rentType: RentType | null;
}

interface CatchupApiRow {
  propertyId: string;
  reference: string;
  reservationId: string;
  guestName: string | null;
  bookingPlatform: string | null;
  checkIn: string;
  checkOut: string;
  grossCents: number;
  platformCommissionCents: number;
  cleaningFeeCents: number | null;
  cleaningError: string | null;
}

interface CatchupRow extends CatchupApiRow {
  sumCents: number | null;
  /** % que représente la commission plateforme (déjà connue en euros) par
   * rapport à Brut + Ménage — null si le ménage n'est pas connu. */
  effectivePercent: number | null;
  /** Part de la commission plateforme imputable au Brut au prorata
   * Brut/(Brut+Ménage) — égale à platformCommissionCents si le ménage est
   * inconnu (tout reste imputé au brut, comme aujourd'hui). */
  commissionOnGrossCents: number;
  /** Part de la commission plateforme imputable au Ménage — le rattrapage
   * à reporter sur le propriétaire, puisqu'aujourd'hui tout est imputé au
   * Brut alors que la plateforme prélève sa commission sur l'ensemble payé
   * par le client (loyer + ménage). Null si le ménage n'est pas connu. */
  commissionOnCleaningCents: number | null;
}

type SortKey =
  | "reference"
  | "checkIn"
  | "gross"
  | "cleaning"
  | "sum"
  | "platformCommission"
  | "commissionOnGross"
  | "commissionOnCleaning";

function toRow(r: CatchupApiRow): CatchupRow {
  const sumCents = r.cleaningFeeCents != null ? r.grossCents + r.cleaningFeeCents : null;
  const effectivePercent = sumCents != null && sumCents > 0 ? (r.platformCommissionCents / sumCents) * 100 : null;
  const commissionOnGrossCents =
    sumCents != null && sumCents > 0 ? Math.round((r.platformCommissionCents * r.grossCents) / sumCents) : r.platformCommissionCents;
  const commissionOnCleaningCents = sumCents != null ? r.platformCommissionCents - commissionOnGrossCents : null;
  return { ...r, sumCents, effectivePercent, commissionOnGrossCents, commissionOnCleaningCents };
}

function Money({ cents, bold = false }: { cents: number | null; bold?: boolean }) {
  if (cents == null) return <span className="text-[#6e6e73]">—</span>;
  return <span className={bold ? "font-semibold" : undefined}>{formatEuros(cents / 100)}</span>;
}

function Percent({ value }: { value: number | null }) {
  if (value == null) return <span className="text-[#6e6e73]">—</span>;
  return <span>{value.toFixed(1)} %</span>;
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "2-digit", timeZone: "UTC" });
}

function SortHeader({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
  align = "right",
  title,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  direction: "asc" | "desc";
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
  title?: string;
}) {
  const isActive = activeKey === sortKey;
  return (
    <th className={`py-1.5 px-2 first:pl-3 last:pr-3 ${align === "right" ? "text-right" : "text-left"}`} title={title}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 text-[11px] font-medium transition ${
          align === "right" ? "flex-row-reverse" : ""
        } ${isActive ? "text-[#1d1d1f]" : "text-[#86868b] hover:text-[#1d1d1f]"}`}
      >
        {label}
        {isActive && <span aria-hidden>{direction === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}

/** Onglet "Rattrapage Ménage" — la commission prélevée par la plateforme de
 * réservation (Airbnb...) est un montant en euros déjà connu côté
 * VRPlatform, mais aujourd'hui entièrement imputé au Brut (Rents) dans les
 * comptes — alors que la plateforme la prélève en réalité sur tout ce que
 * paie le client, ménage compris. Ce tableau répartit ce montant déjà
 * connu au prorata Brut/(Brut+Ménage) : la part qui retombe sur le ménage
 * est le rattrapage à reporter sur le propriétaire. */
export function PropertyCleaningCatchupTable({ properties: unsortedProperties }: { properties: PropertyOption[] }) {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 4 + i);
  const allProperties = useMemo(
    () => [...unsortedProperties].sort((a, b) => a.reference.localeCompare(b.reference, "fr")),
    [unsortedProperties]
  );
  const allTags = useMemo(
    () => Array.from(new Set(allProperties.flatMap((p) => p.tags))).sort((a, b) => a.localeCompare(b, "fr")),
    [allProperties]
  );

  const [year, setYear] = useState(currentYear);
  const [selectedMonths, setSelectedMonths] = useState<number[]>([new Date().getMonth() + 1]);
  const [showPeriodPicker, setShowPeriodPicker] = useState(false);
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>(() => allProperties.map((p) => p.id));
  const [showProperties, setShowProperties] = useState(false);
  const [tagFilters, setTagFilters] = useState<Record<string, "include" | "exclude">>({});
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [rows, setRows] = useState<CatchupApiRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("checkIn");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");

  const includedTags = useMemo(
    () => Object.entries(tagFilters).filter(([, mode]) => mode === "include").map(([tag]) => tag),
    [tagFilters]
  );
  const excludedTags = useMemo(
    () => Object.entries(tagFilters).filter(([, mode]) => mode === "exclude").map(([tag]) => tag),
    [tagFilters]
  );

  const matchingProperties = useMemo(() => {
    return allProperties.filter((p) => {
      const isSelected = selectedPropertyIds.includes(p.id);
      const matchesIncluded = includedTags.length === 0 || p.tags.some((t) => includedTags.includes(t));
      const matchesExcluded = excludedTags.length === 0 || !p.tags.some((t) => excludedTags.includes(t));
      return isSelected && matchesIncluded && matchesExcluded;
    });
  }, [allProperties, selectedPropertyIds, includedTags, excludedTags]);

  const allPlatforms = useMemo(
    () => (rows ? Array.from(new Set(rows.map((r) => r.bookingPlatform ?? "Inconnu"))).sort((a, b) => a.localeCompare(b, "fr")) : []),
    [rows]
  );

  function toggleMonth(month: number) {
    setSelectedMonths((prev) =>
      prev.includes(month) ? prev.filter((m) => m !== month) : [...prev, month].sort((a, b) => a - b)
    );
  }

  function toggleProperty(id: string) {
    setSelectedPropertyIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  function cycleTagFilter(tag: string) {
    setTagFilters((prev) => {
      const next = { ...prev };
      if (next[tag] === "include") next[tag] = "exclude";
      else if (next[tag] === "exclude") delete next[tag];
      else next[tag] = "include";
      return next;
    });
  }

  function togglePlatform(name: string) {
    setSelectedPlatforms((prev) => (prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name]));
  }

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDirection(key === "checkIn" || key === "reference" ? "asc" : "desc");
    }
  }

  async function load() {
    if (matchingProperties.length === 0) {
      setError("Aucun bien ne correspond aux filtres.");
      return;
    }
    if (selectedMonths.length === 0) {
      setError("Sélectionne au moins un mois.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        propertyIds: matchingProperties.map((p) => p.id).join(","),
        year: String(year),
        months: selectedMonths.join(","),
      });
      const res = await fetch(`/api/finance/cleaning-commission-catchup?${params.toString()}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setRows(null);
      } else {
        setRows(data.rows);
        setSelectedPlatforms([]);
      }
    } catch {
      setError("Impossible de charger le rattrapage ménage.");
    } finally {
      setLoading(false);
    }
  }

  const filteredRows = rows
    ? rows.filter((r) => selectedPlatforms.length === 0 || selectedPlatforms.includes(r.bookingPlatform ?? "Inconnu"))
    : null;

  const sortedRows = filteredRows
    ? [...filteredRows.map(toRow)].sort((a, b) => {
        let cmp: number;
        switch (sortKey) {
          case "reference":
            cmp = a.reference.localeCompare(b.reference, "fr");
            break;
          case "checkIn":
            cmp = a.checkIn.localeCompare(b.checkIn);
            break;
          case "gross":
            cmp = a.grossCents - b.grossCents;
            break;
          case "cleaning":
            cmp = (a.cleaningFeeCents ?? 0) - (b.cleaningFeeCents ?? 0);
            break;
          case "sum":
            cmp = (a.sumCents ?? 0) - (b.sumCents ?? 0);
            break;
          case "platformCommission":
            cmp = a.platformCommissionCents - b.platformCommissionCents;
            break;
          case "commissionOnGross":
            cmp = a.commissionOnGrossCents - b.commissionOnGrossCents;
            break;
          case "commissionOnCleaning":
            cmp = (a.commissionOnCleaningCents ?? 0) - (b.commissionOnCleaningCents ?? 0);
            break;
        }
        return direction === "asc" ? cmp : -cmp;
      })
    : null;

  const totals = sortedRows
    ? {
        grossCents: sortedRows.reduce((sum, r) => sum + r.grossCents, 0),
        cleaningFeeCents: sortedRows.reduce((sum, r) => sum + (r.cleaningFeeCents ?? 0), 0),
        sumCents: sortedRows.reduce((sum, r) => sum + (r.sumCents ?? r.grossCents), 0),
        platformCommissionCents: sortedRows.reduce((sum, r) => sum + r.platformCommissionCents, 0),
        commissionOnGrossCents: sortedRows.reduce((sum, r) => sum + r.commissionOnGrossCents, 0),
        commissionOnCleaningCents: sortedRows.reduce((sum, r) => sum + (r.commissionOnCleaningCents ?? 0), 0),
      }
    : null;

  const periodSummary =
    selectedMonths.length === 0
      ? "Aucun mois"
      : selectedMonths.length === 12
        ? `Année complète ${year}`
        : `${selectedMonths.map((m) => MONTH_LABELS_SHORT[m - 1]).join(", ")} ${year}`;

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-[#86868b]">
        La commission prélevée par la plateforme de réservation (Airbnb...) est un montant en euros déjà connu côté
        VRPlatform, mais aujourd&apos;hui entièrement imputé au Brut dans les comptes — alors qu&apos;elle est en
        réalité prélevée sur tout ce que paie le client, ménage compris. Ce tableau répartit ce montant déjà connu au
        prorata Brut/(Brut+Ménage) : la dernière colonne (part imputable au ménage) est le rattrapage à reporter sur
        le propriétaire.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowPeriodPicker((v) => !v)}
            className="flex items-center gap-2 rounded-[10px] border-2 border-[#0071e3] bg-white px-3 py-2 text-[13px] font-medium text-[#0071e3] transition hover:bg-[#0071e3]/5"
          >
            📅 {periodSummary}
            <span aria-hidden className={`transition-transform ${showPeriodPicker ? "rotate-180" : ""}`}>
              ▾
            </span>
          </button>
          {showPeriodPicker && (
            <div className="absolute left-0 top-full z-10 mt-1.5 w-max rounded-[12px] border border-black/10 bg-white p-3.5 shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
              <div>
                <label className="field-label" htmlFor="catchup-year">
                  Année
                </label>
                <select
                  id="catchup-year"
                  value={year}
                  onChange={(e) => setYear(Number.parseInt(e.target.value, 10))}
                  className="mt-1 rounded-[10px] border border-black/10 bg-white px-3 py-2 text-[14px] text-[#1d1d1f] shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus:border-[#0071e3] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
                >
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-3">
                <span className="field-label">Mois</span>
                <div className="mt-1 flex flex-wrap gap-1 max-w-[280px]">
                  {MONTH_LABELS_SHORT.map((label, i) => {
                    const month = i + 1;
                    const active = selectedMonths.includes(month);
                    return (
                      <button
                        key={label}
                        type="button"
                        onClick={() => toggleMonth(month)}
                        className={`rounded-[8px] border px-2.5 py-1.5 text-[13px] font-medium transition ${
                          active
                            ? "border-[#0071e3] bg-[#0071e3] text-white"
                            : "border-black/10 bg-white text-[#1d1d1f] hover:bg-black/[0.04]"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowPeriodPicker(false)}
                className="mt-3 w-full rounded-[8px] bg-[#0071e3] px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-[#0071e3]/90"
              >
                Valider
              </button>
            </div>
          )}
        </div>

        <button type="button" onClick={load} disabled={loading} className="btn-secondary btn-sm">
          {loading ? "Chargement…" : rows ? "Actualiser" : "Charger"}
        </button>
      </div>

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

      {allTags.length > 0 && (
        <div>
          <span className="field-label">Tags</span>
          <p className="mt-0.5 text-[11px] text-[#86868b]">Clic : inclure · reclic : exclure · reclic : neutre</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {allTags.map((tag) => {
              const mode = tagFilters[tag];
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => cycleTagFilter(tag)}
                  title={
                    mode === "include"
                      ? "Inclus — clic pour exclure"
                      : mode === "exclude"
                        ? "Exclu — clic pour désactiver"
                        : "Clic pour inclure"
                  }
                  className={`rounded-full border px-2.5 py-1 text-[13px] font-medium transition ${
                    mode === "include"
                      ? "border-[#0071e3] bg-[#0071e3] text-white"
                      : mode === "exclude"
                        ? "border-[#ff3b30] bg-[#ff3b30] text-white"
                        : "border-black/10 bg-white text-[#1d1d1f] hover:bg-black/[0.04]"
                  }`}
                >
                  {mode === "exclude" ? "− " : mode === "include" ? "+ " : ""}
                  {tag}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {rows && allPlatforms.length > 0 && (
        <div>
          <span className="field-label">Plateforme de réservation</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {allPlatforms.map((name) => {
              const active = selectedPlatforms.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => togglePlatform(name)}
                  className={`rounded-full border px-2.5 py-1 text-[13px] font-medium transition ${
                    active
                      ? "border-[#0071e3] bg-[#0071e3] text-white"
                      : "border-black/10 bg-white text-[#1d1d1f] hover:bg-black/[0.04]"
                  }`}
                >
                  {name}
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
            {sortedRows.length} réservation{sortedRows.length !== 1 ? "s" : ""}
          </p>

          {sortedRows.length === 0 ? (
            <p className="text-[13px] text-[#6e6e73]">Aucune réservation sur cette période.</p>
          ) : (
            <div className="overflow-hidden rounded-[14px] border border-black/[0.06]">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr className="border-b border-black/[0.08] bg-black/[0.015]">
                      <SortHeader label="Bien" sortKey="reference" activeKey={sortKey} direction={direction} onSort={handleSort} align="left" />
                      <th className="py-1.5 px-2 text-left text-[11px] font-medium text-[#86868b]">Séjour</th>
                      <SortHeader label="Brut" sortKey="gross" activeKey={sortKey} direction={direction} onSort={handleSort} title="Rents, avant commission plateforme" />
                      <SortHeader label="Ménage" sortKey="cleaning" activeKey={sortKey} direction={direction} onSort={handleSort} title="Prix ménage facturé au client (Guesty)" />
                      <SortHeader label="Brut + Ménage" sortKey="sum" activeKey={sortKey} direction={direction} onSort={handleSort} />
                      <SortHeader
                        label="Commission plateforme"
                        sortKey="platformCommission"
                        activeKey={sortKey}
                        direction={direction}
                        onSort={handleSort}
                        title="Montant déjà connu côté VRPlatform (Channel Commissions)"
                      />
                      <th className="py-1.5 px-2 text-right text-[11px] font-medium text-[#86868b]" title="Commission plateforme / (Brut + Ménage)">
                        % (Brut+Ménage)
                      </th>
                      <SortHeader
                        label="Comm. sur Brut"
                        sortKey="commissionOnGross"
                        activeKey={sortKey}
                        direction={direction}
                        onSort={handleSort}
                        title="Part de la commission plateforme imputable au Brut au prorata"
                      />
                      <SortHeader
                        label="Comm. sur Ménage — rattrapage"
                        sortKey="commissionOnCleaning"
                        activeKey={sortKey}
                        direction={direction}
                        onSort={handleSort}
                        title="Part de la commission plateforme imputable au ménage — à rattraper sur le propriétaire"
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((r, rowIndex) => (
                      <tr
                        key={r.reservationId}
                        className={`border-b border-black/[0.04] transition-colors last:border-b-0 hover:bg-[#dceafb] ${
                          rowIndex % 2 === 0 ? "bg-white" : "bg-[#f0f6fd]"
                        }`}
                      >
                        <td className="py-1.5 pl-3 pr-2 font-medium text-[#1d1d1f]">
                          {r.reference}
                          {r.cleaningError && (
                            <span title={`Guesty : ${r.cleaningError}`} className="ml-1.5 text-red-600">
                              ⚠
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 px-2 text-[#6e6e73]">
                          {formatDate(r.checkIn)} → {formatDate(r.checkOut)}
                          <div className="text-[10.5px] text-[#86868b]">
                            {r.bookingPlatform ?? "Inconnu"}
                            {r.guestName ? ` · ${r.guestName}` : ""}
                          </div>
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">
                          <Money cents={r.grossCents} />
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">
                          <Money cents={r.cleaningFeeCents} />
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums font-medium text-[#1d1d1f]">
                          <Money cents={r.sumCents} />
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">
                          <Money cents={r.platformCommissionCents} />
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">
                          <Percent value={r.effectivePercent} />
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">
                          <Money cents={r.commissionOnGrossCents} />
                        </td>
                        <td className="py-1.5 pl-2 pr-3 text-right tabular-nums font-semibold text-[#0071e3]">
                          <Money cents={r.commissionOnCleaningCents} bold />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-black/[0.08] bg-black/[0.015] font-semibold text-[#1d1d1f]">
                      <td className="py-1.5 pl-3 pr-2">Total ({sortedRows.length})</td>
                      <td className="py-1.5 px-2"></td>
                      <td className="py-1.5 px-2 text-right tabular-nums">
                        <Money cents={totals.grossCents} bold />
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums">
                        <Money cents={totals.cleaningFeeCents} bold />
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums">
                        <Money cents={totals.sumCents} bold />
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums">
                        <Money cents={totals.platformCommissionCents} bold />
                      </td>
                      <td className="py-1.5 px-2"></td>
                      <td className="py-1.5 px-2 text-right tabular-nums">
                        <Money cents={totals.commissionOnGrossCents} bold />
                      </td>
                      <td className="py-1.5 pl-2 pr-3 text-right tabular-nums text-[#0071e3]">
                        <Money cents={totals.commissionOnCleaningCents} bold />
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {!rows && !loading && !error && (
        <p className="text-[13px] text-[#6e6e73]">Choisis une période, filtre par bien/tag si besoin, puis charge les données.</p>
      )}
    </div>
  );
}
