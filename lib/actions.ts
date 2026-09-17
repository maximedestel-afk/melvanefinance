"use server";

import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";

function requireNonEmpty(value: FormDataEntryValue | null, label: string): string {
  const str = typeof value === "string" ? value.trim() : "";
  if (!str) throw new Error(`${label} est requis.`);
  return str;
}

function optionalString(value: FormDataEntryValue | null): string | null {
  const str = typeof value === "string" ? value.trim() : "";
  return str.length > 0 ? str : null;
}

export async function signIn(formData: FormData) {
  const email = requireNonEmpty(formData.get("email"), "L'email");
  const password = requireNonEmpty(formData.get("password"), "Le mot de passe");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error("Identifiants incorrects.");

  const next = optionalString(formData.get("next")) ?? "/";
  redirect(next);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
