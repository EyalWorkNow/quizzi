import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type SupabaseRestHealth = {
  configured: boolean;
  ok: boolean;
  checkedAt: string;
  message: string;
  tableCount: number | null;
  url_source: string | null;
  key_source: string | null;
};

let adminClient: SupabaseClient | null = null;

function resolveEnvValue(keys: readonly string[]) {
  for (const key of keys) {
    const value = String(process.env[key] || '').trim();
    if (value) {
      return {
        key,
        value,
      };
    }
  }

  return {
    key: null,
    value: '',
  };
}

function getSupabaseUrl() {
  return resolveEnvValue(['SUPABASE_URL', 'VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL']).value;
}

function getSupabaseUrlSource() {
  return resolveEnvValue(['SUPABASE_URL', 'VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL']).key;
}

function getSupabaseSecretKey() {
  return resolveEnvValue(['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY']).value;
}

function getSupabaseSecretKeySource() {
  return resolveEnvValue(['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY']).key;
}

export function isSupabaseAdminConfigured() {
  return Boolean(getSupabaseUrl() && getSupabaseSecretKey());
}

export function getSupabaseAdminClient() {
  if (!adminClient) {
    const url = getSupabaseUrl();
    const secretKey = getSupabaseSecretKey();

    if (!url || !secretKey) {
      throw new Error('Supabase admin client is not configured.');
    }

    adminClient = createClient(url, secretKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return adminClient;
}

export async function checkSupabaseRestHealth(): Promise<SupabaseRestHealth> {
  if (!isSupabaseAdminConfigured()) {
    return {
      configured: false,
      ok: false,
      checkedAt: new Date().toISOString(),
      message:
        'Supabase REST admin client is not configured yet. Set SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY.',
      tableCount: null,
      url_source: getSupabaseUrlSource(),
      key_source: getSupabaseSecretKeySource(),
    };
  }

  try {
    const client = getSupabaseAdminClient();
    const { count, error } = await client.from('quiz_packs').select('*', { count: 'exact', head: true });

    if (error) {
      throw error;
    }

    return {
      configured: true,
      ok: true,
      checkedAt: new Date().toISOString(),
      message: 'Supabase REST admin client is healthy.',
      tableCount: Number(count || 0),
      url_source: getSupabaseUrlSource(),
      key_source: getSupabaseSecretKeySource(),
    };
  } catch (error: any) {
    return {
      configured: true,
      ok: false,
      checkedAt: new Date().toISOString(),
      message: error?.message || 'Supabase REST admin client failed.',
      tableCount: null,
      url_source: getSupabaseUrlSource(),
      key_source: getSupabaseSecretKeySource(),
    };
  }
}
