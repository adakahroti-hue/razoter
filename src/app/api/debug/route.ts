import { NextRequest, NextResponse } from 'next/server';
import { getConfig } from '@/lib/storage';
import { supabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get('secret') !== 'razoter-debug') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const testKey = request.nextUrl.searchParams.get('testkey') || '';

  try {
    const config = await getConfig();

    const result: Record<string, unknown> = {
      configKeyFirst10: config.razoterApiKey?.slice(0, 10),
      configKeyLength: config.razoterApiKey?.length,
      envKeyExists: !!process.env.RAZOTER_API_KEY,
      supabaseUrl: process.env.SUPABASE_URL?.slice(0, 30),
    };

    if (testKey) {
      result.testKeyFirst10 = testKey.slice(0, 10);
      result.testKeyLength = testKey.length;
      result.configKeyMatch = testKey === config.razoterApiKey;

      // api_keys lookup
      const { data, error } = await supabase
        .from('api_keys')
        .select('id, name, key')
        .eq('key', testKey)
        .limit(1)
        .maybeSingle();

      result.apiKeyFound = !!data;
      result.apiKeyLookupError = error?.message || null;

      // List all keys for comparison
      const { data: allKeys } = await supabase
        .from('api_keys')
        .select('id, name, key')
        .limit(5);

      result.allKeys = (allKeys || []).map((k: { id: string; name: string; key: string }) => ({
        name: k.name,
        dbKeyLen: k.key?.length,
        dbKeyFirst10: k.key?.slice(0, 10),
        exactMatch: k.key === testKey,
      }));
    }

    return NextResponse.json(result);
  } catch (e: unknown) {
    const err = e as Error;
    return NextResponse.json({ error: err.message });
  }
}
