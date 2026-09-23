import { createClient } from "./supabase/server";
import { createAdminClient } from "./supabase/admin";
import type { Profile, PropertyFinanceInfo, RentType } from "./types";

export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    email: data.email,
    fullName: data.full_name,
    role: data.role,
  };
}

/** Tous les biens du parc M.G.B avec les informations nécessaires au calcul
 * financier (référence, loyer fixe éventuel, références VRPlatform
 * supplémentaires) — lu directement dans la base Supabase de M.G.B. */
export async function listPropertiesForFinance(): Promise<PropertyFinanceInfo[]> {
  const supabase = await createClient();

  const [
    { data: properties, error: propertiesError },
    { data: owners, error: ownersError },
    { data: settings, error: settingsError },
    { data: propertyData, error: propertyDataError },
    { data: cleaningProviders, error: cleaningProvidersError },
  ] = await Promise.all([
    supabase.from("properties").select("id, reference, name, tags").order("reference", { ascending: true }),
    supabase.from("property_owner").select("property_id, rent_type, rent_amount, charges_amount, commission_percent"),
    supabase.from("property_finance_settings").select("property_id, extra_vrplatform_references"),
    supabase.from("property_data").select("property_id, cleaning_provider_id, bonus_fd_percent"),
    supabase.from("cleaning_providers").select("id, name"),
  ]);
  if (propertiesError) throw propertiesError;
  if (ownersError) throw ownersError;
  if (settingsError) throw settingsError;
  if (propertyDataError) throw propertyDataError;
  if (cleaningProvidersError) throw cleaningProvidersError;

  const ownerByProperty = new Map((owners ?? []).map((o) => [o.property_id, o]));
  const settingsByProperty = new Map((settings ?? []).map((s) => [s.property_id, s]));
  const propertyDataByProperty = new Map((propertyData ?? []).map((d) => [d.property_id, d]));
  const providerNameById = new Map((cleaningProviders ?? []).map((p) => [p.id, p.name]));

  return (properties ?? []).map((property) => {
    const owner = ownerByProperty.get(property.id);
    const setting = settingsByProperty.get(property.id);
    const data = propertyDataByProperty.get(property.id);
    return {
      id: property.id,
      reference: property.reference,
      name: property.name,
      rentType: owner?.rent_type ?? null,
      rentAmount: owner?.rent_amount != null ? owner.rent_amount + (owner.charges_amount ?? 0) : null,
      commissionPercent: owner?.commission_percent ?? null,
      extraVrplatformReferences: setting?.extra_vrplatform_references ?? [],
      tags: property.tags ?? [],
      cleaningProviderName: data?.cleaning_provider_id ? (providerNameById.get(data.cleaning_provider_id) ?? null) : null,
      bonusFdPercent: data?.bonus_fd_percent ?? null,
    };
  });
}

export interface OwnerPropertyInfo {
  id: string;
  reference: string;
  name: string | null;
  rentType: RentType | null;
  commissionPercent: number | null;
  extraVrplatformReferences: string[];
}

/** Biens appartenant au propriétaire dont l'email est fourni — utilisé par
 * l'espace propriétaire. En service_role (comme les autres accès
 * privilégiés de cette app) car les comptes propriétaires n'ont pas de ligne
 * `profiles`/role admin sur laquelle s'appuierait le RLS de M.G.B. L'accès
 * est déjà borné applicativement : seul l'email de l'utilisateur authentifié
 * est utilisé pour filtrer. */
export async function listOwnerProperties(email: string): Promise<OwnerPropertyInfo[]> {
  const supabase = createAdminClient();

  const [
    { data: owners, error: ownersError },
    { data: properties, error: propertiesError },
    { data: settings, error: settingsError },
  ] = await Promise.all([
    supabase.from("property_owner").select("property_id, rent_type, commission_percent").ilike("email", email),
    supabase.from("properties").select("id, reference, name"),
    supabase.from("property_finance_settings").select("property_id, extra_vrplatform_references"),
  ]);
  if (ownersError) throw ownersError;
  if (propertiesError) throw propertiesError;
  if (settingsError) throw settingsError;

  const propertyById = new Map((properties ?? []).map((p) => [p.id, p]));
  const settingsByProperty = new Map((settings ?? []).map((s) => [s.property_id, s]));

  return (owners ?? [])
    .map((owner): OwnerPropertyInfo | null => {
      const property = propertyById.get(owner.property_id);
      if (!property) return null;
      const setting = settingsByProperty.get(owner.property_id);
      return {
        id: property.id,
        reference: property.reference,
        name: property.name,
        rentType: owner.rent_type ?? null,
        commissionPercent: owner.commission_percent ?? null,
        extraVrplatformReferences: setting?.extra_vrplatform_references ?? [],
      };
    })
    .filter((p): p is OwnerPropertyInfo => p !== null);
}
