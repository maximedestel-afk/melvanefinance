"use client";

import { useMemo, useState } from "react";
import { formatEuros, MONTH_LABELS_SHORT } from "@/lib/format";

interface PropertyOption {
  id: string;
  reference: string;
}

interface ReservationDetail {
  reservationId: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  guestName: string | null;
  confirmationCode: string | null;
  bookingPlatform: string | null;
  grossNightlyRateCents: number | null;
  netCommissionableRevenueCents: number;
  commissionCents: number;
  expensesCents: number;
  netRevenueCents: number;
}

function Money({ cents, bold = false }: { cents: number | null; bold?: boolean }) {
  if (cents == null) return <span className="text-[#6e6e73]">—</span>;
  return <span className={bold ? "font-semibold" : undefined}>{formatEuros(cents / 100)}</span>;
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export function PropertyReservationsTable({ properties: unsortedProperties }: { properties: PropertyOption[] }) {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 4 + i);
  const properties = useMemo(
    () => [...unsortedProperties].sort((a, b) => a.reference.localeCompare(b.reference, "fr")),
    [unsortedProperties]
  );

  const [propertyId, setPropertyId] = useState<string>(properties[0]?.id ?? "");
  const [year, setYear] = useState(currentYear);
  const [selectedMonths, setSelectedMonths] = useState<number[]>([new Date().getMonth() + 1]);
  const [reservations, setReservations] = useState<ReservationDetail[] | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleMonth(month: number) {
    setSelectedMonths((prev) =>
      prev.includes(month) ? prev.filter((m) => m !== month) : [...prev, month].sort((a, b) => a - b)
    );
  }

  async function load() {
    if (!propertyId) {
      setError("Choisis un bien.");
      return;
    }
    if (selectedMonths.length === 0) {
      setError("Sélectionne au moins un mois.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ propertyId, year: String(year), months: selectedMonths.join(",") });
      const res = await fetch(`/api/finance/reservations?${params.toString()}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setReservations(null);
      } else {
        setReservations(data.reservations);
        setReference(data.reference);
      }
    } catch {
      setError("Impossible de charger les réservations.");
    } finally {
      setLoading(false);
    }
  }

  const totals = reservations
    ? {
        nights: reservations.reduce((sum, r) => sum + r.nights, 0),
        rentsForAvgCents: reservations.reduce((sum, r) => sum + (r.grossNightlyRateCents ?? 0) * r.nights, 0),
        netCommissionableRevenueCents: reservations.reduce((sum, r) => sum + r.netCommissionableRevenueCents, 0),
        commissionCents: reservations.reduce((sum, r) => sum + r.commissionCents, 0),
        expensesCents: reservations.reduce((sum, r) => sum + r.expensesCents, 0),
        netRevenueCents: reservations.reduce((sum, r) => sum + r.netRevenueCents, 0),
      }
    : null;
  const avgGrossNightlyRateCents = totals && totals.nights > 0 ? Math.round(totals.rentsForAvgCents / totals.nights) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="field-label" htmlFor="res-property">
            Bien
          </label>
          <select
            id="res-property"
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            className="mt-1 rounded-[10px] border border-black/10 bg-white px-3 py-2 text-[14px] text-[#1d1d1f] shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus:border-[#0071e3] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
          >
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.reference}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="field-label" htmlFor="res-year">
            Année
          </label>
          <select
            id="res-year"
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
          {loading ? "Chargement…" : reservations ? "Actualiser" : "Charger"}
        </button>
      </div>

      {error && <p className="text-[13px] text-red-600">{error}</p>}

      {reservations && totals && !loading && !error && (
        <div className="space-y-2">
          <p className="text-[13px] text-[#6e6e73]">
            {reservations.length} réservation{reservations.length !== 1 ? "s" : ""} — {reference}
          </p>

          {reservations.length === 0 ? (
            <p className="text-[13px] text-[#6e6e73]">Aucune réservation sur cette période.</p>
          ) : (
            <div className="overflow-hidden rounded-[14px] border border-black/[0.06]">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[12.5px]">
                  <thead>
                    <tr className="border-b border-black/[0.08] bg-black/[0.015]">
                      <th className="py-2 pl-3 pr-2.5 text-left text-[12px] font-medium text-[#86868b]">Réservation</th>
                      <th className="py-2 px-2.5 text-right text-[12px] font-medium text-[#86868b]">Nuits</th>
                      <th className="py-2 px-2.5 text-right text-[12px] font-medium text-[#86868b]">Prix brut/nuit</th>
                      <th className="py-2 px-2.5 text-right text-[12px] font-medium text-[#86868b]">
                        Net Commissionable Revenue
                      </th>
                      <th className="py-2 px-2.5 text-right text-[12px] font-medium text-[#86868b]">Commission</th>
                      <th className="py-2 px-2.5 text-right text-[12px] font-medium text-[#86868b]">Expenses</th>
                      <th className="py-2 pl-2.5 pr-3 text-right text-[12px] font-medium text-[#86868b]">Net Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reservations.map((r) => (
                      <tr
                        key={r.reservationId}
                        className="border-b border-black/[0.05] transition-colors last:border-b-0 hover:bg-black/[0.015]"
                      >
                        <td className="py-2 pl-3 pr-2.5 text-[#1d1d1f]">
                          <div className="font-medium">
                            {formatDate(r.checkIn)} → {formatDate(r.checkOut)}
                          </div>
                          <div className="text-[11px] text-[#86868b]">
                            {r.guestName ?? "Voyageur inconnu"}
                            {r.bookingPlatform ? ` · ${r.bookingPlatform}` : ""}
                            {r.confirmationCode ? ` · ${r.confirmationCode}` : ""}
                          </div>
                        </td>
                        <td className="py-2 px-2.5 text-right tabular-nums text-[#1d1d1f]">{r.nights}</td>
                        <td className="py-2 px-2.5 text-right tabular-nums text-[#1d1d1f]">
                          <Money cents={r.grossNightlyRateCents} />
                        </td>
                        <td className="py-2 px-2.5 text-right tabular-nums text-[#1d1d1f]">
                          <Money cents={r.netCommissionableRevenueCents} />
                        </td>
                        <td className="py-2 px-2.5 text-right tabular-nums text-[#1d1d1f]">
                          <Money cents={r.commissionCents} />
                        </td>
                        <td className="py-2 px-2.5 text-right tabular-nums text-[#1d1d1f]">
                          <Money cents={r.expensesCents} />
                        </td>
                        <td className="py-2 pl-2.5 pr-3 text-right tabular-nums font-semibold text-[#1d1d1f]">
                          <Money cents={r.netRevenueCents} bold />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-black/[0.08] bg-black/[0.015] font-semibold text-[#1d1d1f]">
                      <td className="py-2 pl-3 pr-2.5">Total ({reservations.length})</td>
                      <td className="py-2 px-2.5 text-right tabular-nums">{totals.nights}</td>
                      <td className="py-2 px-2.5 text-right tabular-nums">
                        <Money cents={avgGrossNightlyRateCents} bold />
                      </td>
                      <td className="py-2 px-2.5 text-right tabular-nums">
                        <Money cents={totals.netCommissionableRevenueCents} bold />
                      </td>
                      <td className="py-2 px-2.5 text-right tabular-nums">
                        <Money cents={totals.commissionCents} bold />
                      </td>
                      <td className="py-2 px-2.5 text-right tabular-nums">
                        <Money cents={totals.expensesCents} bold />
                      </td>
                      <td className="py-2 pl-2.5 pr-3 text-right tabular-nums">
                        <Money cents={totals.netRevenueCents} bold />
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {!reservations && !loading && !error && (
        <p className="text-[13px] text-[#6e6e73]">Choisis un bien, une année et un ou plusieurs mois, puis charge les données.</p>
      )}
    </div>
  );
}
