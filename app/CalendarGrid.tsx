"use client";

export interface CalendarDay {
  date: string;
  status: "available" | "occupied" | "blocked";
  guestName: string | null;
  confirmationCode: string | null;
  source: string | null;
  checkIn: string | null;
  checkOut: string | null;
  priceCents: number | null;
  currency: string | null;
  minNights: number | null;
  note: string | null;
}

const STATUS_STYLE: Record<CalendarDay["status"], { className: string; label: string }> = {
  available: { className: "border-emerald-200 bg-emerald-50 text-emerald-700", label: "Libre" },
  occupied: { className: "border-[#0071e3]/30 bg-[#0071e3]/10 text-[#0071e3]", label: "Occupée" },
  blocked: { className: "border-black/10 bg-black/[0.05] text-[#6e6e73]", label: "Bloquée" },
};

const WEEKDAY_LABELS = ["L", "M", "M", "J", "V", "S", "D"];

const NBSP = " ";

/** Grille calendrier réutilisable (libre/occupée/bloquée, prix/nuit et
 * source de la réservation affichés dans chaque case) — utilisée par la
 * modale de l'espace propriétaire et l'onglet Analyse admin, sur le même
 * modèle que le calendrier M.G.B.
 *
 * Toutes les cases (y compris les cases vides en début de grille) ont la
 * même hauteur fixe : une case dont le contenu varie (prix ou source
 * absents un jour donné) réserve quand même la ligne correspondante avec
 * une espace insécable, pour que les chiffres des jours restent alignés
 * sur la même grille d'une ligne à l'autre. */
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
          <div key={`blank-${i}`} className="h-16" />
        ))}
        {days.map((day) => {
          const style = STATUS_STYLE[day.status];
          const dayNumber = Number.parseInt(day.date.slice(8, 10), 10);
          const titleParts: string[] = [];
          if (day.status === "occupied") {
            titleParts.push(
              `${day.guestName ?? "Voyageur"}${day.source ? ` — ${day.source}` : ""}${day.confirmationCode ? ` (${day.confirmationCode})` : ""}`
            );
          } else {
            titleParts.push(style.label);
            if (day.status === "blocked" && day.note) titleParts.push(day.note);
          }
          if (day.minNights != null) titleParts.push(`Min. ${day.minNights} nuit${day.minNights > 1 ? "s" : ""}`);
          const title = titleParts.join(" · ");
          return (
            <div
              key={day.date}
              title={title}
              className={`flex h-16 w-full flex-col items-center justify-center gap-0.5 overflow-hidden rounded-[8px] border px-0.5 text-[13px] font-medium ${style.className}`}
            >
              <span>{dayNumber}</span>
              <span className="text-[9.5px] font-normal leading-none opacity-80">
                {day.priceCents != null ? `${Math.round(day.priceCents / 100)}€` : NBSP}
              </span>
              <span className="w-full truncate text-center text-[8.5px] font-normal leading-none opacity-70">
                {day.status === "occupied" && day.source ? day.source : NBSP}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}
