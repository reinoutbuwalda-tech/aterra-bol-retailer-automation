import { createClient } from "@supabase/supabase-js";
import { requireEnvironment } from "./config";

export function getSupabaseAdmin() {
  return createClient(
    requireEnvironment("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnvironment("SUPABASE_SECRET_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
