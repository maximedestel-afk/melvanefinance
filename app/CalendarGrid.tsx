"use client";

export interface CalendarDay {
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

/** Grille calendrier réutilisable (libre/occupée/bloquée) — utilisée par la
 * modale de l'espace propriétaire et l'onglet Analyse admin. */
export function CalendarGrid({ days }: { days: CalendarDay[] }) {
  const leadingBlanks = days.length > 0 ? (new Date(`${days[0].date}T00:00:00Z`).getUTCDay() + 6) % 7 : 0;

  return (
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
  );
}
