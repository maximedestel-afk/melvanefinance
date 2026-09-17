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
  rentAmount: number | null;
  /** Références VRPlatform de listings supplémentaires à regrouper avec ce
   * bien (voir l'onglet Finances de M.G.B). */
  extraVrplatformReferences: string[];
  tags: string[];
}
