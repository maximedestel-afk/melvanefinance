import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseAnonKey, supabaseUrl } from "./env";

// Client Supabase côté serveur (Server Components, Server Actions, Route
// Handlers), lié aux cookies de session de la requête courante — même
// projet Supabase que M.G.B, donc les mêmes comptes s'y connectent.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Appelé depuis un Server Component : ignoré, le proxy rafraîchit
          // déjà la session à chaque requête.
        }
      },
    },
  });
}
