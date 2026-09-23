"use client";

import { useMemo, useState } from "react";
import { formatEuros, MONTH_LABELS_SHORT } from "@/lib/format";
import type { PropertyMonthlyResult } from "@/lib/vrplatform";
import type { RentType } from "@/lib/types";

type SortKey = "reference" | "netRevenue" | "fdPercent" | "bonus";

const RENT_TYPE_LABELS: Record<RentType, string> = {
  fixe: "Fixe",
  variable: "Variable",
  fixe_variable: "Fixe + variable",
};

interface PropertyOption {
  id: string;
  reference: string;
  tags: string[];
  rentType: RentType | null;
  bonusFdPercent: number | null;
}

interface BonusRow {
  propertyId: string;
  reference: string;
  notFoundReferences: string[];
  netRevenueCents: number;
  fdPercent: number | null;
  daysInPeriod: number;
  bonusCentsPerDay: number | null;
}

function toRow(property: PropertyMonthlyResult, selectedMonths: number[], fdPercent: number | null): BonusRow {
  const selected = property.months.filter((m) => selectedMonths.includes(m.month));
  const netRevenueCents = selected.reduce((sum, m) => sum + m.netRevenueCents, 0);
  const daysInPeriod = selected.reduce((sum, m) => sum + m.daysInMonth, 0);
  const bonusCentsPerDay =
    fdPercent != null && daysInPeriod > 0 ? Math.round((netRevenueCents * fdPercent) / 100 / daysInPeriod) : null;

  return {
    propertyId: property.propertyId,
    reference: property.reference,
    notFoundReferences: property.notFoundReferences,
    netRevenueCents,
    fdPercent,
    daysInPeriod,
    bonusCentsPerDay,
  };
}

function Money({ cents, bold = false }: { cents: number | null; bold?: boolean }) {
  if (cents == null) return <span className="text-[#6e6e73]">—</span>;
  return <span className={bold ? "font-semibold" : undefined}>{formatEuros(cents / 100)}</span>;
}

function SortHeader({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
  align = "right",
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  direction: "asc" | "desc";
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const isActive = activeKey === sortKey;
  return (
    <th className={`py-2 px-2.5 first:pl-3 last:pr-3 ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 text-[12px] font-medium transition ${
          align === "right" ? "flex-row-reverse" : ""
        } ${isActive ? "text-[#1d1d1f]" : "text-[#86868b] hover:text-[#1d1d1f]"}`}
      >
        {label}
        {isActive && <span aria-hidden>{direction === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}

export function PropertyBonusTable({ properties: unsortedProperties }: { properties: PropertyOption[] }) {
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
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>(() => allProperties.map((p) => p.id));
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedRentTypes, setSelectedRentTypes] = useState<RentType[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("reference");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [results, setResults] = useState<PropertyMonthlyResult[] | null>(null);
  const [removedRowIds, setRemovedRowIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [losses, setLosses] = useState<{ id: string; name: string; amountCents: number }[]>([]);
  const [lossName, setLossName] = useState("");
  const [lossAmount, setLossAmount] = useState("");

  const fdPercentByPropertyId = useMemo(
    () => new Map(allProperties.map((p) => [p.id, p.bonusFdPercent])),
    [allProperties]
  );

  const matchingProperties = useMemo(() => {
    return allProperties.filter((p) => {
      const isSelected = selectedPropertyIds.includes(p.id);
      const matchesTags = selectedTags.length === 0 || p.tags.some((t) => selectedTags.includes(t));
      const matchesRentType = selectedRentTypes.length === 0 || (p.rentType != null && selectedRentTypes.includes(p.rentType));
      return isSelected && matchesTags && matchesRentType;
    });
  }, [allProperties, selectedPropertyIds, selectedTags, selectedRentTypes]);

  function toggleMonth(month: number) {
    setSelectedMonths((prev) =>
      prev.includes(month) ? prev.filter((m) => m !== month) : [...prev, month].sort((a, b) => a - b)
    );
  }

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
    if (selectedMonths.length === 0) {
      setError("Sélectionne au moins un mois.");
      return;
    }
    if (matchingProperties.length === 0) {
      setError("Aucun bien ne correspond aux filtres.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const propertyIds = matchingProperties.map((p) => p.id).join(",");
      const params = new URLSearchParams({ year: String(year), propertyIds });
      const res = await fetch(`/api/finance/monthly?${params.toString()}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setResults(null);
      } else {
        setResults(data.properties);
        setRemovedRowIds(new Set());
      }
    } catch {
      setError("Impossible de charger les données financières.");
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

  function addLoss() {
    const amount = Number.parseFloat(lossAmount.replace(",", "."));
    if (!lossName.trim() || !Number.isFinite(amount) || amount <= 0) return;
    setLosses((prev) => [...prev, { id: crypto.randomUUID(), name: lossName.trim(), amountCents: Math.round(amount * 100) }]);
    setLossName("");
    setLossAmount("");
  }

  function removeLoss(id: string) {
    setLosses((prev) => prev.filter((l) => l.id !== id));
  }

  const rows =
    results
      ?.filter((r) => !removedRowIds.has(r.propertyId))
      .map((r) => toRow(r, selectedMonths, fdPercentByPropertyId.get(r.propertyId) ?? null))
      .filter((r) => r.fdPercent != null && r.bonusCentsPerDay !== 0) ?? null;

  const sortedRows = rows
    ? [...rows].sort((a, b) => {
        let cmp: number;
        switch (sortKey) {
          case "reference":
            cmp = a.reference.localeCompare(b.reference, "fr");
            break;
          case "netRevenue":
            cmp = a.netRevenueCents - b.netRevenueCents;
            break;
          case "fdPercent":
            cmp = (a.fdPercent ?? 0) - (b.fdPercent ?? 0);
            break;
          case "bonus":
            cmp = (a.bonusCentsPerDay ?? 0) - (b.bonusCentsPerDay ?? 0);
            break;
        }
        return direction === "asc" ? cmp : -cmp;
      })
    : null;

  const totals = sortedRows
    ? {
        netRevenueCents: sortedRows.reduce((sum, r) => sum + r.netRevenueCents, 0),
        bonusCentsPerDay: sortedRows.reduce((sum, r) => sum + (r.bonusCentsPerDay ?? 0), 0),
      }
    : null;

  const totalLossCents = losses.reduce((sum, l) => sum + l.amountCents, 0);
  const adjustedBonusCentsPerDay = totals ? totals.bonusCentsPerDay - totalLossCents : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="field-label" htmlFor="bonus-year">
            Année
          </label>
          <select
            id="bonus-year"
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

        <div>
          <span className="field-label">Mois</span>
          <div className="mt-1 flex flex-wrap gap-1">
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

        <button type="button" onClick={load} disabled={loading} className="btn-secondary btn-sm">
          {loading ? "Chargement…" : results ? "Actualiser" : "Charger"}
        </button>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <span className="field-label">Biens</span>
          <div className="flex gap-2">
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
      </div>

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

      <p className="text-[13px] text-[#6e6e73]">
        {matchingProperties.length} bien{matchingProperties.length !== 1 ? "s" : ""} sélectionné
        {matchingProperties.length !== 1 ? "s" : ""}
      </p>

      <div className="rounded-[10px] border border-black/10 bg-white p-3">
        <span className="field-label">Perte de biens</span>
        <div className="mt-1.5 flex flex-wrap items-end gap-2">
          <div>
            <label className="text-[12px] text-[#6e6e73]" htmlFor="loss-name">
              Bien (libre)
            </label>
            <input
              id="loss-name"
              type="text"
              value={lossName}
              onChange={(e) => setLossName(e.target.value)}
              placeholder="Référence ou nom"
              className="mt-0.5 block w-40 rounded-[8px] border border-black/10 bg-white px-2.5 py-1.5 text-[13px] text-[#1d1d1f] focus:border-[#0071e3] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
            />
          </div>
          <div>
            <label className="text-[12px] text-[#6e6e73]" htmlFor="loss-amount">
              Montant à déduire (€)
            </label>
            <input
              id="loss-amount"
              type="text"
              inputMode="decimal"
              value={lossAmount}
              onChange={(e) => setLossAmount(e.target.value)}
              placeholder="0,00"
              className="mt-0.5 block w-32 rounded-[8px] border border-black/10 bg-white px-2.5 py-1.5 text-[13px] text-[#1d1d1f] focus:border-[#0071e3] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
            />
          </div>
          <button type="button" onClick={addLoss} className="btn-secondary btn-sm">
            Ajouter
          </button>
        </div>
        {losses.length > 0 && (
          <ul className="mt-2 space-y-1">
            {losses.map((loss) => (
              <li key={loss.id} className="flex items-center justify-between text-[13px] text-[#1d1d1f]">
                <span>
                  {loss.name} <span className="text-[#6e6e73]">— {formatEuros(loss.amountCents / 100)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => removeLoss(loss.id)}
                  title="Retirer cette perte"
                  className="text-[#c7c7cc] transition hover:text-red-600"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="text-[13px] text-red-600">{error}</p>}

      {sortedRows && sortedRows.length === 0 && !loading && !error && (
        <p className="text-[13px] text-[#6e6e73]">
          Aucun bien sélectionné n&apos;a de FD% renseigné ou de bonus non nul sur cette période.
        </p>
      )}

      {sortedRows && sortedRows.length > 0 && totals && !loading && !error && (
        <div className="space-y-2">
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
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr className="border-b border-black/[0.08] bg-black/[0.015]">
                    <SortHeader
                      label="Bien"
                      sortKey="reference"
                      activeKey={sortKey}
                      direction={direction}
                      onSort={handleSort}
                      align="left"
                    />
                    <SortHeader
                      label="Net Revenue"
                      sortKey="netRevenue"
                      activeKey={sortKey}
                      direction={direction}
                      onSort={handleSort}
                    />
                    <SortHeader label="FD %" sortKey="fdPercent" activeKey={sortKey} direction={direction} onSort={handleSort} />
                    <SortHeader label="Bonus / jour" sortKey="bonus" activeKey={sortKey} direction={direction} onSort={handleSort} />
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row) => (
                    <tr
                      key={row.propertyId}
                      className="border-b border-black/[0.05] transition-colors last:border-b-0 hover:bg-black/[0.015]"
                    >
                      <td className="py-2 pl-3 pr-2.5 text-[#1d1d1f]">
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
                      <td className="py-2 px-2.5 text-right tabular-nums font-semibold text-[#1d1d1f]">
                        <Money cents={row.netRevenueCents} bold />
                      </td>
                      <td className="py-2 px-2.5 text-right tabular-nums text-[#1d1d1f]">
                        {row.fdPercent != null ? `${row.fdPercent} %` : <span className="text-[#6e6e73]">—</span>}
                      </td>
                      <td className="py-2 pl-2.5 pr-3 text-right tabular-nums font-semibold text-[#1d1d1f]">
                        <Money cents={row.bonusCentsPerDay} bold />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-black/[0.08] bg-black/[0.015] font-semibold text-[#1d1d1f]">
                    <td className="py-2 pl-3 pr-2.5">
                      Total ({sortedRows.length} bien{sortedRows.length !== 1 ? "s" : ""})
                    </td>
                    <td className="py-2 px-2.5 text-right tabular-nums">
                      <Money cents={totals.netRevenueCents} bold />
                    </td>
                    <td className="py-2 px-2.5"></td>
                    <td className="py-2 pl-2.5 pr-3 text-right tabular-nums">
                      <Money cents={totals.bonusCentsPerDay} bold />
                    </td>
                  </tr>
                  {losses.length > 0 && (
                    <>
                      {losses.map((loss) => (
                        <tr key={loss.id} className="border-t border-black/[0.05] text-[#1d1d1f]">
                          <td className="py-1.5 pl-3 pr-2.5 text-[#6e6e73]">Perte — {loss.name}</td>
                          <td className="py-1.5 px-2.5"></td>
                          <td className="py-1.5 px-2.5"></td>
                          <td className="py-1.5 pl-2.5 pr-3 text-right tabular-nums text-red-600">
                            −{formatEuros(loss.amountCents / 100)}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t border-black/[0.08] bg-black/[0.015] font-semibold text-[#1d1d1f]">
                        <td className="py-2 pl-3 pr-2.5">Total ajusté</td>
                        <td className="py-2 px-2.5"></td>
                        <td className="py-2 px-2.5"></td>
                        <td className="py-2 pl-2.5 pr-3 text-right tabular-nums">
                          <Money cents={adjustedBonusCentsPerDay} bold />
                        </td>
                      </tr>
                    </>
                  )}
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {!results && !loading && !error && (
        <p className="text-[13px] text-[#6e6e73]">
          Choisis une année, un ou plusieurs mois, filtre par bien/tag si besoin, puis charge les données.
        </p>
      )}
    </div>
  );
}
