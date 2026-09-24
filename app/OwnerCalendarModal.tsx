"use client";

import { useEffect, useState } from "react";
import { MONTH_LABELS_SHORT } from "@/lib/format";

interface CalendarDay {
  date: string;
  status: "available" | "occupied" | "blocked";
  guestName: string | null;
  confirmationCode: string | null;
  source: string | null;
  checkIn: string | null;
  checkOut: string | null;
}

const STATUS_STYLE: Record<CalendarDay["status"], { className: string; label: string }> = {
  available: { className: "border-emerald-200 bg-emerald-50 text-emerald-700", label: "Libre" },
  occupied: { className: "border-[#0071e3]/30 bg-[#0071e3]/10 text-[#0071e3]", label: "Occupée" },
  blocked: { className: "border-black/10 bg-black/[0.05] text-[#6e6e73]", label: "Bloquée" },
};

const WEEKDAY_LABELS = ["L", "M", "M", "J", "V", "S", "D"];

export function OwnerCalendarModal({
  propertyId,
  propertyLabel,
  year,
  month,
  onClose,
}: {
  propertyId: string;
  propertyLabel: string;
  year: number;
  month: number;
  onClose: () => void;
}) {
  const [days, setDays] = useState<CalendarDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setDays(null);
      setError(null);
      try {
        const res = await fetch(`/api/owner/calendar?propertyId=${propertyId}&year=${year}&month=${month}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.error) setError(data.error);
        else setDays(data.days);
      } catch {
        if (!cancelled) setError("Impossible de charger le calendrier.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [propertyId, year, month]);

  const leadingBlanks = days && days.length > 0 ? (new Date(`${days[0].date}T00:00:00Z`).getUTCDay() + 6) % 7 : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-[480px] overflow-y-auto rounded-[16px] bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[16px] font-semibold text-[#1d1d1f]">
            {propertyLabel} — {MONTH_LABELS_SHORT[month - 1]} {year}
          </h3>
          <button type="button" onClick={onClose} className="text-[15px] text-[#6e6e73] hover:text-[#1d1d1f]">
            ✕
          </button>
        </div>

        {error && <p className="text-[13px] text-red-600">{error}</p>}
        {!error && !days && <p className="text-[13px] text-[#6e6e73]">Chargement…</p>}

        {days && (
          <>
            <div className="mb-3 flex flex-wrap gap-3 text-[12px] text-[#1d1d1f]">
              {(Object.keys(STATUS_STYLE) as CalendarDay["status"][]).map((status) => (
                <span key={status} className="flex items-center gap-1.5">
                  <span className={`inline-block h-3 w-3 rounded-[4px] border ${STATUS_STYLE[status].className}`} />
                  {STATUS_STYLE[status].label}
                </span>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1.5">
              {WEEKDAY_LABELS.map((label, i) => (
                <div key={i} className="text-center text-[11px] font-medium text-[#86868b]">
                  {label}
                </div>
              ))}
              {Array.from({ length: leadingBlanks }).map((_, i) => (
                <div key={`blank-${i}`} />
              ))}
              {days.map((day) => {
                const style = STATUS_STYLE[day.status];
                const dayNumber = Number.parseInt(day.date.slice(8, 10), 10);
                const title =
                  day.status === "occupied"
                    ? `${day.guestName ?? "Voyageur"}${day.source ? ` — ${day.source}` : ""}${day.confirmationCode ? ` (${day.confirmationCode})` : ""}`
                    : style.label;
                return (
                  <div
                    key={day.date}
                    title={title}
                    className={`flex aspect-square flex-col items-center justify-center rounded-[8px] border text-[13px] font-medium ${style.className}`}
                  >
                    {dayNumber}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
