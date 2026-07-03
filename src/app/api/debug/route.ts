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

    // Simulate verifyApiKey logic step by step
    const steps: any = {};

    // Step 1: config key match
    steps.configKeyLength = config.razoterApiKey?.length;
    steps.configKeyFirst10 = config.razoterApiKey?.slice(0, 10);
    if (testKey) {
      steps.testKeyLength = testKey.length;
      steps.testKeyFirst10 = testKey.slice(0, 10);
      steps.configKeyMatch = testKey === config.razoterApiKey;
      // Check char codes
      if (!steps.configKeyMatch && testKey.length === config.razoterApiKey?.length) {
        steps.configDiffAt = [];
        for (let i = 0; i < testKey.length; i++) {
          if (testKey[i] !== config.razoterApiKey![i]) {
            steps.configDiffAt.push({ pos: i, expected: config.razoterApiKey![i], got: testKey[i] });
          }
        }
      }
    }

    // Step 2: api_keys table lookup
    if (testKey) {
      const { data, error } = await supabase
        .from('api_keys')
        .select('id, name, key')
        .eq('key', testKey)
        .limit(1)
        .maybeSingle();
      steps.apiKeyTableLookup = data ? { found: true, id: data.id, name: data.name } : { found: false };
      steps.apiKeyLookupError = error?.message || null;

      // Also try exact match manually
      const { data: allKeys } = await supabase
        .from('api_keys')
        .select('id, name, key')
        .limit(5);
      steps.allKeysCount = allKeys?.length || 0;
      if (allKeys && allKeys.length > 0) {
        steps.allKeysComparison = allKeys.map(k => ({
          name: k.name,
          dbKeyLength: k.key?.length,
          testKeyLength: testKey.length,
          exactMatch: k.key === testKey,
          dbKeyFirst10: k.key?.slice(0, 10),
          testKeyFirst10: testKey.slice(0, 10),
          // Check for hidden chars
          dbKeyCharCodes: Array.from(k.key || '').slice(0, 5).map(c => c.charCodeAt(0)),
          testKeyCharCodes: Array.from(testKey).slice(0, 5).map(c => c.charCodeAt(0)),
        }));
      }
    }

    return NextResponse.json({ steps, configMode: config.mode });
  } catch (e: any) {
    return NextResponse.json({ error: e.message, stack: e.stack?.slice(0, 500) });
  }
}
