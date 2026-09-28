export function formatEuros(value: number): string {
  return `${value.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}€`;
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)} %`;
}

export const MONTH_LABELS_SHORT = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];

/** Date du jour au format YYYY-MM-DD (UTC, pour rester cohérent avec les
 * dates VRPlatform/Guesty qui sont toutes en UTC). */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** `iso` + `days` jours, au format YYYY-MM-DD. */
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Rouge (peu rempli) → vert (bien rempli), sur l'échelle 0–100 %. */
export function fillRateBadgeStyle(fillRate: number): { backgroundColor: string; color: string } {
  const hue = Math.max(0, Math.min(1, fillRate)) * 130;
  return {
    backgroundColor: `hsl(${hue} 85% 94%)`,
    color: `hsl(${hue} 70% 30%)`,
  };
}
