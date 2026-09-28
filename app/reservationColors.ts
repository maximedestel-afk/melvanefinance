// Une couleur par réservation distincte (nuits occupées uniquement),
// attribuées dans l'ordre chronologique de rencontre dans la liste de jours
// — deux réservations qui se suivent ont donc toujours des couleurs
// différentes, même adjacentes dans la grille. Utilisé par CalendarGrid ET
// DailyPriceChart pour qu'une même réservation ait exactement la même
// couleur dans le calendrier et dans le graphique.
//
// `hex` est la valeur réellement rendue par les classes Tailwind de
// `className` (vérifiée en lisant getComputedStyle dans le navigateur, pas
// devinée — Tailwind v4 dérive ses couleurs par défaut d'OKLCH, dont
// l'équivalent sRGB ne correspond pas aux hex "historiques" de Tailwind v3).
export interface ReservationColor {
  /** Classes Tailwind pour une case du calendrier (CalendarGrid). */
  className: string;
  /** Équivalent hex de la couleur de bordure ci-dessus, pour un contexte qui
   * ne peut pas utiliser de classes Tailwind (attribut SVG stroke). */
  hex: string;
}

export const RESERVATION_PALETTE: ReservationColor[] = [
  { className: "border-4 border-[#0071e3] bg-[#0071e3]/10 text-[#0071e3]", hex: "#0071e3" },
  { className: "border-4 border-purple-500 bg-purple-50 text-purple-700", hex: "#ad46ff" },
  { className: "border-4 border-teal-500 bg-teal-50 text-teal-700", hex: "#00bba7" },
  { className: "border-4 border-pink-500 bg-pink-50 text-pink-700", hex: "#f6339a" },
  { className: "border-4 border-amber-500 bg-amber-50 text-amber-700", hex: "#fe9a00" },
  { className: "border-4 border-indigo-500 bg-indigo-50 text-indigo-700", hex: "#615fff" },
  { className: "border-4 border-cyan-500 bg-cyan-50 text-cyan-700", hex: "#00b8db" },
  { className: "border-4 border-rose-500 bg-rose-50 text-rose-700", hex: "#ff2056" },
];

/** Associe chaque confirmationCode occupé de `days` à une couleur de
 * réservation distincte, dans l'ordre chronologique de rencontre. */
export function assignReservationColors<T extends { status: string; confirmationCode: string | null }>(
  days: T[]
): Map<string, ReservationColor> {
  const colorByConfirmationCode = new Map<string, ReservationColor>();
  for (const day of days) {
    if (day.status !== "occupied" || !day.confirmationCode) continue;
    if (!colorByConfirmationCode.has(day.confirmationCode)) {
      colorByConfirmationCode.set(
        day.confirmationCode,
        RESERVATION_PALETTE[colorByConfirmationCode.size % RESERVATION_PALETTE.length]
      );
    }
  }
  return colorByConfirmationCode;
}
