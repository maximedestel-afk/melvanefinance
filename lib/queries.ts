import { createClient } from "./supabase/server";
import type { Profile, PropertyFinanceInfo } from "./types";

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
  ] = await Promise.all([
    supabase.from("properties").select("id, reference, name, tags").order("reference", { ascending: true }),
    supabase.from("property_owner").select("property_id, rent_type, rent_amount, charges_amount, commission_percent"),
    supabase.from("property_finance_settings").select("property_id, extra_vrplatform_references"),
  ]);
  if (propertiesError) throw propertiesError;
  if (ownersError) throw ownersError;
  if (settingsError) throw settingsError;

  const ownerByProperty = new Map((owners ?? []).map((o) => [o.property_id, o]));
  const settingsByProperty = new Map((settings ?? []).map((s) => [s.property_id, s]));

  return (properties ?? []).map((property) => {
    const owner = ownerByProperty.get(property.id);
    const setting = settingsByProperty.get(property.id);
    return {
      id: property.id,
      reference: property.reference,
      name: property.name,
      rentType: owner?.rent_type ?? null,
      rentAmount: owner?.rent_amount != null ? owner.rent_amount + (owner.charges_amount ?? 0) : null,
      commissionPercent: owner?.commission_percent ?? null,
      extraVrplatformReferences: setting?.extra_vrplatform_references ?? [],
      tags: property.tags ?? [],
    };
  });
}
