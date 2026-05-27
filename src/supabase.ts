import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Cloud sync is OPTIONAL. If the env vars aren't set (e.g. before the user
// configures Supabase, or in a fork), `supabase` is null and the app falls
// back to localStorage-only behavior — nothing breaks.
//
// Read `import.meta.env` defensively: in Vite it's the env object, but when
// this file is bundled into a CJS target (Obsidian plugin) `import.meta` is
// an empty stub and a naive `.env.VITE_…` access would throw at module load
// and crash whatever pulled this in.
const ENV = ((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {}) as Record<string, string | undefined>;
const url = ENV.VITE_SUPABASE_URL;
const anonKey = ENV.VITE_SUPABASE_ANON_KEY;

export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null;

export const isCloudEnabled = supabase !== null;
