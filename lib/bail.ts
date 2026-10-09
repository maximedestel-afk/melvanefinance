/** Logique de calcul pour l'onglet Bail (franchise de loyer + prorata de fin
 * de mois) — lit `property_owner.lease_start_date` et
 * `property_owner.lease_rent_free_period`, deux colonnes `text` libres côté
 * M.G.B (onglet "Bail" de GestionDesBiens), sans format imposé à la saisie :
 * la date est en principe au format ISO (champ `<input type="date">` côté
 * M.G.B) mais la franchise est une chaîne totalement libre (ex: "2 semaines",
 * "1 mois", parfois même un montant en euros selon qui l'a saisie) — d'où le
 * parsing tolérant ci-dessous plutôt qu'un format strict. */

const FRANCHISE_PATTERN = /^(\d+(?:[.,]\d+)?)\s*(jours?|j|semaines?|sem|mois)\b/i;

/** Calcule la date de fin de franchise (= premier jour où le loyer est dû) à
 * partir de la date de début de bail (ISO `YYYY-MM-DD`) et du texte libre de
 * franchise. Retourne `null` si l'une des deux valeurs est manquante ou si le
 * texte de franchise n'est pas reconnu comme une durée. Les mois sont ajoutés
 * en arithmétique calendaire exacte (pas une approximation ×30 jours). */
export function computeFranchiseEndIso(leaseStartIso: string, franchiseText: string): string | null {
  const match = franchiseText.trim().match(FRANCHISE_PATTERN);
  if (!match) return null;
  const amount = Number.parseFloat(match[1].replace(",", "."));
  if (!Number.isFinite(amount)) return null;
  const unit = match[2].toLowerCase();

  const d = new Date(`${leaseStartIso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;

  if (unit.startsWith("j")) {
    d.setUTCDate(d.getUTCDate() + Math.round(amount));
  } else if (unit.startsWith("sem")) {
    d.setUTCDate(d.getUTCDate() + Math.round(amount * 7));
  } else {
    d.setUTCMonth(d.getUTCMonth() + Math.round(amount));
  }
  return d.toISOString().slice(0, 10);
}

export interface BailProrata {
  franchiseEndIso: string | null;
  franchiseRecognized: boolean;
  daysRemainingInMonth: number | null;
  daysInMonth: number | null;
  loyerProrataCents: number | null;
}

/** Prorata du loyer (seul, hors charges) pour le mois où se termine la
 * franchise : le loyer est dû à partir du jour de fin de franchise inclus
 * (le dernier jour gratuit est la veille) jusqu'à la fin de ce mois-là —
 * c'est un calcul ponctuel ancré sur la franchise du bail, pas sur "le mois
 * en cours", donc un bail déjà ancien affiche toujours son prorata d'origine
 * (la case "payé" sert à le solder, pas à le faire disparaître). */
export function computeBailProrata(
  leaseStartIso: string | null,
  franchiseText: string | null,
  rentAmountEuros: number | null
): BailProrata {
  const empty: BailProrata = {
    franchiseEndIso: null,
    franchiseRecognized: false,
    daysRemainingInMonth: null,
    daysInMonth: null,
    loyerProrataCents: null,
  };
  if (!leaseStartIso || !franchiseText) return empty;

  const franchiseEndIso = computeFranchiseEndIso(leaseStartIso, franchiseText);
  if (!franchiseEndIso) return empty;

  const franchiseEnd = new Date(`${franchiseEndIso}T00:00:00Z`);
  const year = franchiseEnd.getUTCFullYear();
  const month = franchiseEnd.getUTCMonth();
  const dayOfMonth = franchiseEnd.getUTCDate();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const daysRemainingInMonth = Math.max(0, daysInMonth - dayOfMonth + 1);
  const loyerProrataCents =
    rentAmountEuros != null ? Math.round((rentAmountEuros * 100 * daysRemainingInMonth) / daysInMonth) : null;

  return { franchiseEndIso, franchiseRecognized: true, daysRemainingInMonth, daysInMonth, loyerProrataCents };
}
