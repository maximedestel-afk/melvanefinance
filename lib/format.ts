export function formatEuros(value: number): string {
  return `${value.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}€`;
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)} %`;
}

export const MONTH_LABELS_SHORT = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];

/** Rouge (peu rempli) → vert (bien rempli), sur l'échelle 0–100 %. */
export function fillRateBadgeStyle(fillRate: number): { backgroundColor: string; color: string } {
  const hue = Math.max(0, Math.min(1, fillRate)) * 130;
  return {
    backgroundColor: `hsl(${hue} 85% 94%)`,
    color: `hsl(${hue} 70% 30%)`,
  };
}
