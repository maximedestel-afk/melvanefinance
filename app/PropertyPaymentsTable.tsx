"use client";

import { useMemo, useState } from "react";
import { formatEuros, todayIso, addDaysIso } from "@/lib/format";
import type { RentType } from "@/lib/types";

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
}

interface ReservationApiRow {
  propertyId: string;
  reference: string;
  confirmationCode: string | null;
  checkIn: string;
  bookingPlatform: string | null;
  guestName: string | null;
  netCommissionableRevenueCents: number;
}

interface PaymentRow extends ReservationApiRow {
  expectedPaymentDate: string;
  received: boolean;
  late: boolean;
}

function Money({ cents }: { cents: number | null }) {
  if (cents == null) return <span className="text-[#6e6e73]">—</span>;
  return <span>{formatEuros(cents / 100)}</span>;
}

function formatShortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", timeZone: "UTC" });
}

function escapeCsvField(value: string): string {
  if (/[";\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function PropertyPaymentsTable({ properties: unsortedProperties }: { properties: PropertyOption[] }) {
  const allProperties = useMemo(
    () => [...unsortedProperties].sort((a, b) => a.reference.localeCompare(b.reference, "fr")),
    [unsortedProperties]
  );
  const allTags = useMemo(
    () => Array.from(new Set(allProperties.flatMap((p) => p.tags))).sort((a, b) => a.localeCompare(b, "fr")),
    [allProperties]
  );

  const today = todayIso();
  const [mode, setMode] = useState<"date" | "range">("range");
  const [date, setDate] = useState(today);
  const [rangeStart, setRangeStart] = useState(today);
  const [rangeEnd, setRangeEnd] = useState(addDaysIso(today, 6));
  const [showPeriodPicker, setShowPeriodPicker] = useState(false);
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>(() => allProperties.map((p) => p.id));
  const [showProperties, setShowProperties] = useState(false);
  const [tagFilters, setTagFilters] = useState<Record<string, "include" | "exclude">>({});
  const [selectedRentTypes, setSelectedRentTypes] = useState<RentType[]>([]);
  const [hideReceived, setHideReceived] = useState(false);
  const [reservations, setReservations] = useState<ReservationApiRow[] | null>(null);
  const [receivedCodes, setReceivedCodes] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [togglingCode, setTogglingCode] = useState<string | null>(null);

  const includedTags = useMemo(
    () => Object.entries(tagFilters).filter(([, m]) => m === "include").map(([tag]) => tag),
    [tagFilters]
  );
  const excludedTags = useMemo(
    () => Object.entries(tagFilters).filter(([, m]) => m === "exclude").map(([tag]) => tag),
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

  async function load() {
    if (matchingProperties.length === 0) {
      setError("Aucun bien ne correspond aux filtres.");
      return;
    }
    const startDate = mode === "date" ? date : rangeStart;
    const endDate = mode === "date" ? date : rangeEnd;
    if (startDate > endDate) {
      setError("La date de fin doit être après la date de début.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        startDate,
        endDate,
        propertyIds: matchingProperties.map((p) => p.id).join(","),
      });
      const [resvRes, receivedRes] = await Promise.all([
        fetch(`/api/finance/payments-pending?${params.toString()}`),
        fetch("/api/finance/payments-received"),
      ]);
      const resvData = await resvRes.json();
      const receivedData = await receivedRes.json();
      if (resvData.error) {
        setError(resvData.error);
        setReservations(null);
      } else {
        setReservations(resvData.reservations);
        setReceivedCodes(new Set(receivedData.receivedConfirmationCodes ?? []));
      }
    } catch {
      setError("Impossible de charger les paiements.");
    } finally {
      setLoading(false);
    }
  }

  async function toggleReceived(confirmationCode: string, received: boolean) {
    setTogglingCode(confirmationCode);
    const previous = new Set(receivedCodes);
    setReceivedCodes((prev) => {
      const next = new Set(prev);
      if (received) next.add(confirmationCode);
      else next.delete(confirmationCode);
      return next;
    });
    try {
      const res = await fetch("/api/finance/payments-received", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationCode, received }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setReceivedCodes(previous);
      }
    } catch {
      setError("Impossible d'enregistrer le statut du paiement.");
      setReceivedCodes(previous);
    } finally {
      setTogglingCode(null);
    }
  }

  // Paiement attendu le lendemain du check-in (Airbnb et Booking.com) —
  // "en retard" si cette date est passée et le paiement pas encore marqué
  // reçu.
  const rows: PaymentRow[] | null = reservations
    ? reservations
        .filter((r) => r.confirmationCode != null)
        .map((r) => {
          const expectedPaymentDate = addDaysIso(r.checkIn, 1);
          const received = receivedCodes.has(r.confirmationCode as string);
          return {
            ...r,
            expectedPaymentDate,
            received,
            late: !received && expectedPaymentDate <= today,
          };
        })
        .filter((r) => !hideReceived || !r.received)
        .sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.reference.localeCompare(b.reference, "fr"))
    : null;

  function exportCsv() {
    if (!rows || rows.length === 0) return;
    const rowsForCsv = [
      ["Bien", "Plateforme", "Check-in", "Paiement attendu", "Montant", "Reçu"],
      ...rows.map((r) => [
        r.reference,
        r.bookingPlatform ?? "",
        r.checkIn,
        r.expectedPaymentDate,
        (r.netCommissionableRevenueCents / 100).toFixed(2),
        r.received ? "Oui" : "Non",
      ]),
    ];
    const csvContent = rowsForCsv.map((r) => r.map(escapeCsvField).join(";")).join("\r\n");
    const blob = new Blob(["﻿" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `paiements_${mode === "date" ? date : `${rangeStart}_${rangeEnd}`}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const periodSummary =
    mode === "date"
      ? new Date(`${date}T00:00:00Z`).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
      : `${rangeStart} → ${rangeEnd}`;

  const lateCount = rows?.filter((r) => r.late).length ?? 0;

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-[#6e6e73]">
        Paiement attendu le lendemain du check-in (Airbnb et Booking.com) — Moret exclu (facturation hors VRPlatform).
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <span className="field-label">Période (check-in)</span>
          <button
            type="button"
            onClick={() => setShowPeriodPicker((v) => !v)}
            className="mt-1 flex h-9 items-center gap-2 rounded-[10px] border-2 border-[#0071e3] bg-white px-3 text-[13px] font-medium text-[#0071e3] transition hover:bg-[#0071e3]/5"
          >
            📅 {periodSummary}
            <span aria-hidden className={`transition-transform ${showPeriodPicker ? "rotate-180" : ""}`}>
              ▾
            </span>
          </button>
          {showPeriodPicker && (
            <div className="absolute left-0 top-full z-10 mt-1.5 w-max rounded-[12px] border border-black/10 bg-white p-3.5 shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
              <div className="flex gap-1 rounded-[8px] border border-black/10 bg-black/[0.03] p-0.5">
                <button
                  type="button"
                  onClick={() => setMode("date")}
                  className={`flex-1 rounded-[6px] px-2.5 py-1 text-[12px] font-medium transition ${
                    mode === "date" ? "bg-white text-[#1d1d1f] shadow-sm" : "text-[#6e6e73] hover:text-[#1d1d1f]"
                  }`}
                >
                  Une date
                </button>
                <button
                  type="button"
                  onClick={() => setMode("range")}
                  className={`flex-1 rounded-[6px] px-2.5 py-1 text-[12px] font-medium transition ${
                    mode === "range" ? "bg-white text-[#1d1d1f] shadow-sm" : "text-[#6e6e73] hover:text-[#1d1d1f]"
                  }`}
                >
                  Période
                </button>
              </div>

              {mode === "date" ? (
                <div className="mt-3">
                  <label className="field-label" htmlFor="payments-date">
                    Date de check-in
                  </label>
                  <input
                    id="payments-date"
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="mt-1 rounded-[10px] border border-black/10 bg-white px-3 py-2 text-[14px] text-[#1d1d1f] shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus:border-[#0071e3] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
                  />
                </div>
              ) : (
                <div className="mt-3 flex items-end gap-2">
                  <div>
                    <label className="field-label" htmlFor="payments-range-start">
                      Du
                    </label>
                    <input
                      id="payments-range-start"
                      type="date"
                      value={rangeStart}
                      onChange={(e) => setRangeStart(e.target.value)}
                      className="mt-1 rounded-[10px] border border-black/10 bg-white px-3 py-2 text-[14px] text-[#1d1d1f] shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus:border-[#0071e3] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="payments-range-end">
                      Au
                    </label>
                    <input
                      id="payments-range-end"
                      type="date"
                      value={rangeEnd}
                      onChange={(e) => setRangeEnd(e.target.value)}
                      className="mt-1 rounded-[10px] border border-black/10 bg-white px-3 py-2 text-[14px] text-[#1d1d1f] shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus:border-[#0071e3] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
                    />
                  </div>
                </div>
              )}

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

        <div>
          <span className="field-label invisible">Charger</span>
          <button type="button" onClick={load} disabled={loading} className="btn-secondary btn-sm mt-1 h-9">
            {loading ? "Chargement…" : reservations ? "Actualiser" : "Charger"}
          </button>
        </div>
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
              const tagMode = tagFilters[tag];
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => cycleTagFilter(tag)}
                  title={
                    tagMode === "include"
                      ? "Inclus — clic pour exclure"
                      : tagMode === "exclude"
                        ? "Exclu — clic pour désactiver"
                        : "Clic pour inclure"
                  }
                  className={`rounded-full border px-2.5 py-1 text-[13px] font-medium transition ${
                    tagMode === "include"
                      ? "border-[#0071e3] bg-[#0071e3] text-white"
                      : tagMode === "exclude"
                        ? "border-[#ff3b30] bg-[#ff3b30] text-white"
                        : "border-black/10 bg-white text-[#1d1d1f] hover:bg-black/[0.04]"
                  }`}
                >
                  {tagMode === "exclude" ? "− " : tagMode === "include" ? "+ " : ""}
                  {tag}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <label className="flex w-fit items-center gap-1.5 text-[13px] text-[#1d1d1f]">
        <input
          type="checkbox"
          checked={hideReceived}
          onChange={(e) => setHideReceived(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-black/20 text-[#0071e3] focus:ring-[#0071e3]/40"
        />
        Masquer les paiements déjà reçus
      </label>

      {error && <p className="text-[13px] text-red-600">{error}</p>}

      {rows && rows.length === 0 && !loading && !error && (
        <p className="text-[13px] text-[#6e6e73]">Aucune réservation sur cette période.</p>
      )}

      {rows && rows.length > 0 && !loading && !error && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span
              className={`rounded-full px-3 py-1.5 text-[13px] font-semibold ${
                lateCount > 0 ? "bg-red-50 text-red-600" : "bg-[#0071e3]/10 text-[#0071e3]"
              }`}
            >
              {rows.length} paiement{rows.length !== 1 ? "s" : ""} · {lateCount} en retard
            </span>
            <button type="button" onClick={exportCsv} className="btn-secondary btn-sm">
              Exporter (CSV)
            </button>
          </div>
          <div className="overflow-hidden rounded-[14px] border border-black/[0.06]">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-black/[0.08] bg-black/[0.015]">
                    <th className="py-1.5 pl-3 pr-2 text-left text-[11px] font-medium text-[#86868b]">Bien</th>
                    <th className="py-1.5 px-2 text-left text-[11px] font-medium text-[#86868b]">Plateforme</th>
                    <th className="py-1.5 px-2 text-right text-[11px] font-medium text-[#86868b]">Check-in</th>
                    <th className="py-1.5 px-2 text-right text-[11px] font-medium text-[#86868b]">Paiement attendu</th>
                    <th className="py-1.5 px-2 text-right text-[11px] font-medium text-[#86868b]">Montant</th>
                    <th className="py-1.5 px-2 text-center text-[11px] font-medium text-[#86868b]">Statut</th>
                    <th className="py-1.5 pl-2 pr-3 text-right text-[11px] font-medium text-[#86868b]">Reçu</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rowIndex) => (
                    <tr
                      key={`${row.propertyId}-${row.confirmationCode}`}
                      className={`border-b border-black/[0.04] transition-colors last:border-b-0 hover:bg-[#dceafb] ${
                        rowIndex % 2 === 0 ? "bg-white" : "bg-[#f0f6fd]"
                      }`}
                    >
                      <td className="py-1.5 pl-3 pr-2 font-medium text-[#1d1d1f]">{row.reference}</td>
                      <td className="py-1.5 px-2 text-[#6e6e73]">{row.bookingPlatform ?? "—"}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">{formatShortDate(row.checkIn)}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">
                        {formatShortDate(row.expectedPaymentDate)}
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">
                        <Money cents={row.netCommissionableRevenueCents} />
                      </td>
                      <td className="py-1.5 px-2 text-center">
                        {row.received ? (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-600">
                            Reçu
                          </span>
                        ) : row.late ? (
                          <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-600">
                            En retard
                          </span>
                        ) : (
                          <span className="rounded-full bg-black/[0.04] px-2 py-0.5 text-[11px] font-medium text-[#6e6e73]">
                            À venir
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 pl-2 pr-3 text-right">
                        <input
                          type="checkbox"
                          checked={row.received}
                          disabled={togglingCode === row.confirmationCode || !row.confirmationCode}
                          onChange={(e) => row.confirmationCode && toggleReceived(row.confirmationCode, e.target.checked)}
                          className="h-4 w-4 rounded border-black/20 text-[#0071e3] focus:ring-[#0071e3]/40"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {!reservations && !loading && !error && (
        <p className="text-[13px] text-[#6e6e73]">Choisis une date ou une période de check-in, filtre si besoin, puis charge les données.</p>
      )}
    </div>
  );
}
