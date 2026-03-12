import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type SupabaseRestHealth = {
  configured: boolean;
  ok: boolean;
  checkedAt: string;
  message: string;
  tableCount: number | null;
};

let adminClient: SupabaseClient | null = null;

function getSupabaseUrl() {
  return String(process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
}

function getSupabaseSecretKey() {
  return String(process.env.SUPABASE_SECRET_KEY || '').trim();
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
      message: 'Supabase REST admin client is not configured yet.',
      tableCount: null,
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
    };
  } catch (error: any) {
    return {
      configured: true,
      ok: false,
      checkedAt: new Date().toISOString(),
      message: error?.message || 'Supabase REST admin client failed.',
      tableCount: null,
    };
  }
}
