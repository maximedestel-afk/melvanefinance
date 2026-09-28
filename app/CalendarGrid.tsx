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

// "Libre" reste très sobre (fond blanc, bordure fine) pour ne pas rivaliser
// visuellement avec les nuits occupées, qui portent un encadré épais et
// saturé (border-4) — le contraste entre les deux rend le remplissage
// lisible d'un coup d'œil, sans avoir à lire le prix de chaque case.
const STATUS_STYLE: Record<CalendarDay["status"], { className: string; label: string }> = {
  available: { className: "border border-black/10 bg-white text-[#6e6e73]", label: "Libre" },
  occupied: { className: "border-4 border-[#0071e3] bg-[#0071e3]/10 text-[#0071e3]", label: "Occupée" },
  blocked: { className: "border border-dashed border-black/15 bg-black/[0.04] text-[#6e6e73]", label: "Bloquée" },
};

// Une couleur par réservation distincte (occupied uniquement) — attribuées
// dans l'ordre chronologique de rencontre, donc deux réservations qui se
// suivent ont toujours des couleurs différentes, même adjacentes dans la
// grille. Sert à distinguer d'un coup d'œil une réservation de 5 nuits de 5
// réservations d'1 nuit qui se suivent.
const RESERVATION_PALETTE = [
  "border-4 border-[#0071e3] bg-[#0071e3]/10 text-[#0071e3]",
  "border-4 border-purple-500 bg-purple-50 text-purple-700",
  "border-4 border-teal-500 bg-teal-50 text-teal-700",
  "border-4 border-pink-500 bg-pink-50 text-pink-700",
  "border-4 border-amber-500 bg-amber-50 text-amber-700",
  "border-4 border-indigo-500 bg-indigo-50 text-indigo-700",
  "border-4 border-cyan-500 bg-cyan-50 text-cyan-700",
  "border-4 border-rose-500 bg-rose-50 text-rose-700",
];

const WEEKDAY_LABELS = ["L", "M", "M", "J", "V", "S", "D"];

const NBSP = " ";

/** Grille calendrier réutilisable (libre/occupée/bloquée, prix/nuit et
 * source de la réservation affichés dans chaque case) — utilisée par la
 * modale de l'espace propriétaire et l'onglet Analyse admin, sur le même
 * modèle que le calendrier M.G.B.
 *
 * Toutes les cases (y compris les cases vides en début de grille) ont la
 * même hauteur fixe : une case dont le contenu varie (prix ou source
 * absents un jour donné) réserve quand même la ligne correspondante avec
 * une espace insécable, pour que les chiffres des jours restent alignés
 * sur la même grille d'une ligne à l'autre.
 *
 * Les nuits occupées d'une même réservation partagent la même couleur (voir
 * RESERVATION_PALETTE), pour qu'une réservation de plusieurs nuits reste
 * visuellement distincte de plusieurs réservations d'une nuit qui se
 * suivent. */
export function CalendarGrid({ days }: { days: CalendarDay[] }) {
  const leadingBlanks = days.length > 0 ? (new Date(`${days[0].date}T00:00:00Z`).getUTCDay() + 6) % 7 : 0;

  const colorByConfirmationCode = new Map<string, string>();
  for (const day of days) {
    if (day.status !== "occupied" || !day.confirmationCode) continue;
    if (!colorByConfirmationCode.has(day.confirmationCode)) {
      colorByConfirmationCode.set(
        day.confirmationCode,
        RESERVATION_PALETTE[colorByConfirmationCode.size % RESERVATION_PALETTE.length]
      );
    }
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap gap-3 text-[12px] text-[#1d1d1f]">
        {(Object.keys(STATUS_STYLE) as CalendarDay["status"][]).map((status) => (
          <span key={status} className="flex items-center gap-1.5">
            <span className={`inline-block h-3 w-3 rounded-[4px] ${STATUS_STYLE[status].className}`} />
            {STATUS_STYLE[status].label}
          </span>
        ))}
        <span className="text-[#86868b]">— une couleur par réservation</span>
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
          const className =
            day.status === "occupied" && day.confirmationCode
              ? (colorByConfirmationCode.get(day.confirmationCode) ?? STATUS_STYLE.occupied.className)
              : STATUS_STYLE[day.status].className;
          const dayNumber = Number.parseInt(day.date.slice(8, 10), 10);
          const titleParts: string[] = [];
          if (day.status === "occupied") {
            titleParts.push(
              `${day.guestName ?? "Voyageur"}${day.source ? ` — ${day.source}` : ""}${day.confirmationCode ? ` (${day.confirmationCode})` : ""}`
            );
          } else {
            titleParts.push(STATUS_STYLE[day.status].label);
            if (day.status === "blocked" && day.note) titleParts.push(day.note);
          }
          if (day.minNights != null) titleParts.push(`Min. ${day.minNights} nuit${day.minNights > 1 ? "s" : ""}`);
          const title = titleParts.join(" · ");
          return (
            <div
              key={day.date}
              title={title}
              className={`flex h-16 w-full flex-col items-center justify-center gap-0.5 overflow-hidden rounded-[8px] px-0.5 text-[13px] font-medium ${className}`}
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
