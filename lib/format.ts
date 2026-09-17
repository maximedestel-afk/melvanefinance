export function formatEuros(value: number): string {
  return `${value.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}€`;
}

export function formatPercent(value: number): string {
  return `${(value * 100).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 1 })} %`;
}

export const MONTH_LABELS_SHORT = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];
