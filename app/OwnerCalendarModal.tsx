"use client";

import { useEffect, useState } from "react";
import { MONTH_LABELS_SHORT } from "@/lib/format";
import { CalendarGrid, type CalendarDay } from "./CalendarGrid";

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

        {days && <CalendarGrid days={days} />}
      </div>
    </div>
  );
}
