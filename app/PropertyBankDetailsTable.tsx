"use client";

import { useEffect, useState } from "react";
import { formatEuros } from "@/lib/format";

interface BankDetails {
  iban: string;
  accountName: string;
  accountReference: string;
  autoPaymentSetup: boolean;
}

const EMPTY_DETAILS: BankDetails = { iban: "", accountName: "", accountReference: "", autoPaymentSetup: false };

interface PropertyOption {
  id: string;
  reference: string;
  rentAmount: number | null;
  ownerLastName: string | null;
  ownerFirstName: string | null;
}

export function PropertyBankDetailsTable({ properties }: { properties: PropertyOption[] }) {
  const sortedProperties = [...properties].sort((a, b) => a.reference.localeCompare(b.reference, "fr"));

  const [detailsByPropertyId, setDetailsByPropertyId] = useState<Record<string, BankDetails>>({});
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-[#6e6e73]">
        RIB (relevé d&apos;identité bancaire) de chaque bien. Le nom du propriétaire vient de Gestion des Biens
        (non modifiable ici) ; l&apos;IBAN, le nom du compte et sa référence se saisissent et s&apos;enregistrent
        directement dans cette app. L&apos;IBAN est enregistré sans espaces, quelle que soit la façon dont il est
        saisi ou collé.
      </p>

      {error && <p className="text-[13px] text-red-600">{error}</p>}

      {loading && <p className="text-[13px] text-[#6e6e73]">Chargement…</p>}

      {!loading && (
        <div className="overflow-hidden rounded-[14px] border border-black/[0.06]">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-black/[0.08] bg-black/[0.015]">
                  <th className="py-1.5 pl-3 pr-2 text-left text-[11px] font-medium text-[#86868b]">Bien</th>
                  <th className="py-1.5 px-2 text-left text-[11px] font-medium text-[#86868b]">Nom du propriétaire</th>
                  <th className="py-1.5 px-2 text-left text-[11px] font-medium text-[#86868b]">IBAN</th>
                  <th className="py-1.5 px-2 text-left text-[11px] font-medium text-[#86868b]">Nom du compte</th>
                  <th className="py-1.5 px-2 text-left text-[11px] font-medium text-[#86868b]">Référence du compte</th>
                  <th className="py-1.5 px-2 text-right text-[11px] font-medium text-[#86868b]">Loyer total</th>
                  <th className="py-1.5 pl-2 pr-3 text-center text-[11px] font-medium text-[#86868b]">Paiement auto</th>
                </tr>
              </thead>
              <tbody>
                {sortedProperties.map((property, rowIndex) => {
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
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
