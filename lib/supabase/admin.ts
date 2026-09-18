import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "./env";

// Client Supabase service_role — contourne les RLS, réservé aux opérations
// serveur privilégiées (ex: cache du token OAuth2 Guesty). Jamais exposé au
// client, jamais utilisé pour des requêtes liées à un utilisateur.
export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY n'est pas défini.");
  return createClient(supabaseUrl(), serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
