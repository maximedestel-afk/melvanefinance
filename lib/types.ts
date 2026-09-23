export type UserRole = "admin" | "operations" | "manager" | "menage" | "prestataire";

export interface Profile {
  id: string;
  email: string;
  fullName: string | null;
  role: UserRole;
}

export type RentType = "fixe" | "variable" | "fixe_variable";

/** Un bien du parc M.G.B, avec les informations nécessaires au calcul
 * financier — lu depuis la même base Supabase que M.G.B (tables
 * `properties`, `property_owner`, `property_finance_settings`). */
export interface PropertyFinanceInfo {
  id: string;
  reference: string;
  name: string | null;
  rentType: RentType | null;
  /** Loyer fixe total payé au propriétaire (rent_amount + charges_amount). */
  rentAmount: number | null;
  /** Pourcentage de commission M.G.B (ex: 20 pour 20 %), appliqué au Net
   * Commissionable Revenue pour les biens en modèle variable. */
  commissionPercent: number | null;
  /** Références VRPlatform de listings supplémentaires à regrouper avec ce
   * bien (voir l'onglet Finances de M.G.B). */
  extraVrplatformReferences: string[];
  tags: string[];
  /** Nom du prestataire de ménage assigné (table `cleaning_providers` de
   * M.G.B, liée via `property_data.cleaning_provider_id`). */
  cleaningProviderName: string | null;
}
