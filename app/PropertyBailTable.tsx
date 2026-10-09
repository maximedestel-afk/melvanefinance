"use client";

import { useEffect, useState } from "react";
import { formatEuros } from "@/lib/format";

interface BailRow {
  propertyId: string;
  reference: string;
  leaseStartDate: string | null;
  franchiseText: string | null;
  franchiseRecognized: boolean;
  franchiseEndDate: string | null;
  daysRemainingInMonth: number | null;
  daysInMonth: number | null;
  loyerProrataCents: number | null;
  chargesCents: number | null;
  totalCents: number | null;
}

function Money({ cents }: { cents: number | null }) {
  if (cents == null) return <span className="text-[#6e6e73]">—</span>;
  return <span>{formatEuros(cents / 100)}</span>;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export function PropertyBailTable() {
  const [rows, setRows] = useState<BailRow[] | null>(null);
  const [paidIds, setPaidIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [rowsRes, paidRes] = await Promise.all([
        fetch("/api/finance/bail"),
        fetch("/api/finance/bail-paid"),
      ]);
      const rowsData = await rowsRes.json();
      const paidData = await paidRes.json();
      if (rowsData.error) {
        setError(rowsData.error);
        return;
      }
      setRows(rowsData.rows);
      setPaidIds(new Set(paidData.paidPropertyIds ?? []));
    } catch {
      setError("Impossible de charger les données.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  async function togglePaid(propertyId: string, paid: boolean) {
    setTogglingId(propertyId);
    const previous = new Set(paidIds);
    setPaidIds((prev) => {
      const next = new Set(prev);
      if (paid) next.add(propertyId);
      else next.delete(propertyId);
      return next;
    });
    try {
      const res = await fetch("/api/finance/bail-paid", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, paid }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setPaidIds(previous);
      }
    } catch {
      setError("Impossible d'enregistrer le statut de paiement.");
      setPaidIds(previous);
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button type="button" onClick={load} disabled={loading} className="btn-secondary btn-sm">
          {loading ? "Chargement…" : rows ? "Actualiser" : "Charger"}
        </button>
        <p className="text-[12px] text-[#6e6e73]">
          Biens avec une date de début de bail renseignée (onglet Bail de M.G.B.) — franchise lue depuis le texte
          libre « Franchise de loyer », convertie en jours. Le prorata est calculé sur le mois où se termine la
          franchise, pas sur le mois en cours.
        </p>
      </div>

      {error && <p className="text-[13px] text-red-600">{error}</p>}

      {rows && rows.length === 0 && !loading && !error && (
        <p className="text-[13px] text-[#6e6e73]">Aucun bien n&apos;a de date de début de bail renseignée.</p>
      )}

      {rows && rows.length > 0 && !loading && !error && (
        <div className="overflow-hidden rounded-[14px] border border-black/[0.06]">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-black/[0.08] bg-black/[0.015]">
                  <th className="py-1.5 pl-3 pr-2 text-left text-[11px] font-medium text-[#86868b]">Bien</th>
                  <th className="py-1.5 px-2 text-right text-[11px] font-medium text-[#86868b]">Début de bail</th>
                  <th className="py-1.5 px-2 text-right text-[11px] font-medium text-[#86868b]">Franchise</th>
                  <th className="py-1.5 px-2 text-right text-[11px] font-medium text-[#86868b]">Jours restants</th>
                  <th className="py-1.5 px-2 text-right text-[11px] font-medium text-[#86868b]">Loyer prorata</th>
                  <th className="py-1.5 px-2 text-right text-[11px] font-medium text-[#86868b]">Charges</th>
                  <th className="py-1.5 px-2 text-right text-[11px] font-medium text-[#86868b]">Total</th>
                  <th className="py-1.5 pl-2 pr-3 text-right text-[11px] font-medium text-[#86868b]">Payé</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr
                    key={row.propertyId}
                    className={`border-b border-black/[0.04] transition-colors last:border-b-0 hover:bg-[#dceafb] ${
                      rowIndex % 2 === 0 ? "bg-white" : "bg-[#f0f6fd]"
                    }`}
                  >
                    <td className="py-1.5 pl-3 pr-2 font-medium text-[#1d1d1f]">{row.reference}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">
                      {formatDate(row.leaseStartDate)}
                    </td>
                    <td className="py-1.5 px-2 text-right text-[#1d1d1f]">
                      {row.franchiseText || <span className="text-[#6e6e73]">—</span>}
                      {row.franchiseText && !row.franchiseRecognized && (
                        <span
                          title="Texte non reconnu comme une durée (jours/semaines/mois) — prorata non calculable."
                          className="ml-1.5 text-amber-600"
                        >
                          ⚠
                        </span>
                      )}
                      {row.franchiseEndDate && (
                        <div className="text-[10.5px] text-[#86868b]">jusqu&apos;au {formatDate(row.franchiseEndDate)}</div>
                      )}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">
                      {row.daysRemainingInMonth != null ? `${row.daysRemainingInMonth} / ${row.daysInMonth}` : "—"}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">
                      <Money cents={row.loyerProrataCents} />
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">
                      <Money cents={row.chargesCents} />
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums font-semibold text-[#1d1d1f]">
                      <Money cents={row.totalCents} />
                    </td>
                    <td className="py-1.5 pl-2 pr-3 text-right">
                      <input
                        type="checkbox"
                        checked={paidIds.has(row.propertyId)}
                        disabled={togglingId === row.propertyId}
                        onChange={(e) => togglePaid(row.propertyId, e.target.checked)}
                        className="h-4 w-4 rounded border-black/20 text-[#0071e3] focus:ring-[#0071e3]/40"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
