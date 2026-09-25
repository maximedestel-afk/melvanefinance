"use client";

import { useEffect, useState } from "react";
import { formatEuros } from "@/lib/format";

interface ExpenseLineItem {
  accountName: string;
  cents: number;
}

export function ExpenseDetailModal({
  propertyId,
  propertyLabel,
  year,
  months,
  onClose,
}: {
  propertyId: string;
  propertyLabel: string;
  year: number;
  months: number[];
  onClose: () => void;
}) {
  const [lines, setLines] = useState<ExpenseLineItem[] | null>(null);
  const [totalCents, setTotalCents] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLines(null);
      setError(null);
      try {
        const params = new URLSearchParams({ propertyId, year: String(year), months: months.join(",") });
        const res = await fetch(`/api/finance/expense-detail?${params.toString()}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
        } else {
          setLines(data.lines);
          setTotalCents(data.totalCents);
        }
      } catch {
        if (!cancelled) setError("Impossible de charger le détail des dépenses.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [propertyId, year, months]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-[420px] overflow-y-auto rounded-[16px] bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[16px] font-semibold text-[#1d1d1f]">Détail des dépenses — {propertyLabel}</h3>
          <button type="button" onClick={onClose} className="text-[15px] text-[#6e6e73] hover:text-[#1d1d1f]">
            ✕
          </button>
        </div>

        {error && <p className="text-[13px] text-red-600">{error}</p>}
        {!error && !lines && <p className="text-[13px] text-[#6e6e73]">Chargement…</p>}

        {lines && (
          <>
            {lines.length === 0 ? (
              <p className="text-[13px] text-[#6e6e73]">Aucune écriture sur cette période.</p>
            ) : (
              <table className="w-full border-collapse text-[13px]">
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.accountName} className="border-b border-black/[0.05] last:border-b-0">
                      <td className="py-2 pr-2 text-[#1d1d1f]">{line.accountName}</td>
                      <td className="py-2 pl-2 text-right tabular-nums font-medium text-[#1d1d1f]">
                        {formatEuros(line.cents / 100)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-black/[0.08] font-semibold text-[#1d1d1f]">
                    <td className="py-2 pr-2">Total (valeur absolue affichée dans le tableau)</td>
                    <td className="py-2 pl-2 text-right tabular-nums">{formatEuros(Math.abs(totalCents ?? 0) / 100)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
            <p className="mt-3 text-[11px] text-[#86868b]">
              Montants signés tels que postés par VRPlatform (compte par compte). Le total de la colonne Expenses est
              la valeur absolue de leur somme.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
