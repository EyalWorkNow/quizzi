import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let browserClient: SupabaseClient | null = null;

function getSupabaseUrl() {
  return String(import.meta.env.VITE_SUPABASE_URL || import.meta.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
}

function getSupabasePublishableKey() {
  return String(
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
      import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
      '',
  ).trim();
}

export function isSupabaseBrowserConfigured() {
  return Boolean(getSupabaseUrl() && getSupabasePublishableKey());
}

export function getSupabasePublicConfig() {
  return {
    url: getSupabaseUrl(),
    publishableKeyConfigured: Boolean(getSupabasePublishableKey()),
  };
}

export function getSupabaseClient() {
  if (!browserClient) {
    const url = getSupabaseUrl();
    const key = getSupabasePublishableKey();

    if (!url || !key) {
      throw new Error('Supabase browser client is not configured.');
    }

    browserClient = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });
  }

  return browserClient;
}
