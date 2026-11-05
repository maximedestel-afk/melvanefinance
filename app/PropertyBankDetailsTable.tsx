"use client";

import { useEffect, useMemo, useState } from "react";
import { formatEuros } from "@/lib/format";
import type { RentType } from "@/lib/types";

interface BankDetails {
  iban: string;
  accountName: string;
  accountReference: string;
  autoPaymentSetup: boolean;
}

const EMPTY_DETAILS: BankDetails = { iban: "", accountName: "", accountReference: "", autoPaymentSetup: false };

const RENT_TYPE_LABELS: Record<RentType, string> = {
  fixe: "Fixe",
  variable: "Variable",
  fixe_variable: "Fixe + variable",
};

interface PropertyOption {
  id: string;
  reference: string;
  rentAmount: number | null;
  rentType: RentType | null;
  tags: string[];
  ownerLastName: string | null;
  ownerFirstName: string | null;
}

export function PropertyBankDetailsTable({ properties: unsortedProperties }: { properties: PropertyOption[] }) {
  const allProperties = useMemo(
    () => [...unsortedProperties].sort((a, b) => a.reference.localeCompare(b.reference, "fr")),
    [unsortedProperties]
  );
  const allTags = useMemo(
    () => Array.from(new Set(allProperties.flatMap((p) => p.tags))).sort((a, b) => a.localeCompare(b, "fr")),
    [allProperties]
  );

  const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>(() => allProperties.map((p) => p.id));
  const [showProperties, setShowProperties] = useState(false);
  const [tagFilters, setTagFilters] = useState<Record<string, "include" | "exclude">>({});
  const [selectedRentTypes, setSelectedRentTypes] = useState<RentType[]>([]);

  const [detailsByPropertyId, setDetailsByPropertyId] = useState<Record<string, BankDetails>>({});
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function toggleProperty(id: string) {
    setSelectedPropertyIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  // Cycle à trois états par tag : neutre → inclure → exclure → neutre.
  function cycleTagFilter(tag: string) {
    setTagFilters((prev) => {
      const next = { ...prev };
      if (next[tag] === "include") next[tag] = "exclude";
      else if (next[tag] === "exclude") delete next[tag];
      else next[tag] = "include";
      return next;
    });
  }

  function toggleRentType(rentType: RentType) {
    setSelectedRentTypes((prev) => (prev.includes(rentType) ? prev.filter((t) => t !== rentType) : [...prev, rentType]));
  }

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
      const matchesRentType = selectedRentTypes.length === 0 || (p.rentType != null && selectedRentTypes.includes(p.rentType));
      return isSelected && matchesIncluded && matchesExcluded && matchesRentType;
    });
  }, [allProperties, selectedPropertyIds, includedTags, excludedTags, selectedRentTypes]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/finance/bank-details");
        const data = await res.json();
        if (data.error) {
          setError(data.error);
          return;
        }
        const next: Record<string, BankDetails> = {};
        for (const row of data.details as {
          propertyId: string;
          iban: string | null;
          accountName: string | null;
          accountReference: string | null;
          autoPaymentSetup: boolean;
        }[]) {
          next[row.propertyId] = {
            iban: row.iban ?? "",
            accountName: row.accountName ?? "",
            accountReference: row.accountReference ?? "",
            autoPaymentSetup: row.autoPaymentSetup ?? false,
          };
        }
        setDetailsByPropertyId(next);
      } catch {
        setError("Impossible de charger les RIB.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function updateField(propertyId: string, field: keyof BankDetails, value: string) {
    setDetailsByPropertyId((prev) => ({
      ...prev,
      [propertyId]: { ...(prev[propertyId] ?? EMPTY_DETAILS), [field]: value },
    }));
  }

  async function save(propertyId: string, details?: BankDetails) {
    const toSave = details ?? detailsByPropertyId[propertyId] ?? EMPTY_DETAILS;
    setSavingIds((prev) => new Set(prev).add(propertyId));
    try {
      const res = await fetch("/api/finance/bank-details", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, ...toSave }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
    } catch {
      setError("Impossible d'enregistrer ce RIB.");
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(propertyId);
        return next;
      });
    }
  }

  function toggleAutoPayment(propertyId: string, checked: boolean) {
    const next = { ...(detailsByPropertyId[propertyId] ?? EMPTY_DETAILS), autoPaymentSetup: checked };
    setDetailsByPropertyId((prev) => ({ ...prev, [propertyId]: next }));
    save(propertyId, next);
  }

  function ownerName(property: PropertyOption): string {
    return [property.ownerLastName, property.ownerFirstName].filter((part) => part && part.trim() !== "").join(" ");
  }

  const totals = useMemo(() => {
    const totalRentAmount = matchingProperties.reduce((sum, p) => sum + (p.rentAmount ?? 0), 0);
    const autoPaymentCount = matchingProperties.filter((p) => detailsByPropertyId[p.id]?.autoPaymentSetup).length;
    return { totalRentAmount, autoPaymentCount };
  }, [matchingProperties, detailsByPropertyId]);

  const thClass =
    "sticky top-0 z-10 border-b border-black/[0.08] bg-[#fafafc] py-1.5 px-2 text-left text-[11px] font-medium text-[#86868b]";

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-[#6e6e73]">
        RIB (relevé d&apos;identité bancaire) de chaque bien. Le nom du propriétaire vient de Gestion des Biens
        (non modifiable ici) ; l&apos;IBAN, le nom du compte et sa référence se saisissent et s&apos;enregistrent
        directement dans cette app. L&apos;IBAN est enregistré sans espaces, quelle que soit la façon dont il est
        saisi ou collé.
      </p>

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

      {error && <p className="text-[13px] text-red-600">{error}</p>}

      {loading && <p className="text-[13px] text-[#6e6e73]">Chargement…</p>}

      {!loading && matchingProperties.length === 0 && (
        <p className="text-[13px] text-[#6e6e73]">Aucun bien ne correspond aux filtres.</p>
      )}

      {!loading && matchingProperties.length > 0 && (
        <div className="overflow-hidden rounded-[14px] border border-black/[0.06]">
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr>
                  <th className={`${thClass} pl-3`}>Bien</th>
                  <th className={thClass}>Nom du propriétaire</th>
                  <th className={thClass}>IBAN</th>
                  <th className={thClass}>Nom du compte</th>
                  <th className={thClass}>Référence du compte</th>
                  <th className={`${thClass} text-right`}>Loyer total</th>
                  <th className={`${thClass} pr-3 text-center`}>Paiement auto</th>
                </tr>
              </thead>
              <tbody>
                {matchingProperties.map((property, rowIndex) => {
                  const details = detailsByPropertyId[property.id] ?? EMPTY_DETAILS;
                  const saving = savingIds.has(property.id);
                  const name = ownerName(property);
                  return (
                    <tr
                      key={property.id}
                      className={`border-b border-black/[0.04] last:border-b-0 ${
                        rowIndex % 2 === 0 ? "bg-white" : "bg-[#f0f6fd]"
                      }`}
                    >
                      <td className="py-1.5 pl-3 pr-2 font-medium text-[#1d1d1f]">{property.reference}</td>
                      <td className="py-1.5 px-2 text-[#1d1d1f]">
                        {name || <span className="text-[#6e6e73]">— (non renseigné dans Gestion des Biens)</span>}
                      </td>
                      <td className="py-1 px-2">
                        <input
                          type="text"
                          value={details.iban}
                          onChange={(e) => updateField(property.id, "iban", e.target.value.replace(/\s+/g, ""))}
                          onBlur={() => save(property.id)}
                          placeholder="FR76XXXXXXXXXXXXXXXXXXXXXXX"
                          disabled={saving}
                          className="w-64 rounded-[8px] border border-black/10 bg-white px-2 py-1 font-mono text-[12px] uppercase text-[#1d1d1f] focus:border-[#0071e3] focus:outline-none focus:ring-[2px] focus:ring-[#0071e3]/15"
                        />
                      </td>
                      <td className="py-1 px-2">
                        <input
                          type="text"
                          value={details.accountName}
                          onChange={(e) => updateField(property.id, "accountName", e.target.value)}
                          onBlur={() => save(property.id)}
                          placeholder="Nom du compte"
                          disabled={saving}
                          className="w-48 rounded-[8px] border border-black/10 bg-white px-2 py-1 text-[12px] text-[#1d1d1f] focus:border-[#0071e3] focus:outline-none focus:ring-[2px] focus:ring-[#0071e3]/15"
                        />
                      </td>
                      <td className="py-1 px-2">
                        <input
                          type="text"
                          value={details.accountReference}
                          onChange={(e) => updateField(property.id, "accountReference", e.target.value)}
                          onBlur={() => save(property.id)}
                          placeholder="Référence du compte"
                          disabled={saving}
                          className="w-40 rounded-[8px] border border-black/10 bg-white px-2 py-1 text-[12px] text-[#1d1d1f] focus:border-[#0071e3] focus:outline-none focus:ring-[2px] focus:ring-[#0071e3]/15"
                        />
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">
                        {property.rentAmount != null ? (
                          formatEuros(property.rentAmount)
                        ) : (
                          <span className="text-[#6e6e73]">—</span>
                        )}
                      </td>
                      <td className="py-1.5 pl-2 pr-3 text-center">
                        <input
                          type="checkbox"
                          checked={details.autoPaymentSetup}
                          disabled={saving}
                          onChange={(e) => toggleAutoPayment(property.id, e.target.checked)}
                          className="h-4 w-4 rounded border-black/20 text-[#0071e3] focus:ring-[#0071e3]/40"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="sticky bottom-0 border-t border-black/[0.08] bg-[#fafafc] font-semibold text-[#1d1d1f]">
                  <td className="py-1.5 pl-3 pr-2" colSpan={5}>
                    Total ({matchingProperties.length} bien{matchingProperties.length !== 1 ? "s" : ""}) ·{" "}
                    {totals.autoPaymentCount} paiement{totals.autoPaymentCount !== 1 ? "s" : ""} auto
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{formatEuros(totals.totalRentAmount)}</td>
                  <td className="py-1.5 pl-2 pr-3"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
