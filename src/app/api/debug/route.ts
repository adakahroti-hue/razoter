import { NextRequest, NextResponse } from 'next/server';
import { getConfig } from '@/lib/storage';
import { supabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  // Only allow with secret param
  if (request.nextUrl.searchParams.get('secret') !== 'razoter-debug') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const config = await getConfig();
    
    // Test api_keys table
    const { data: keys, error: keysError } = await supabase
      .from('api_keys')
      .select('id, name, key')
      .limit(5);

    // Test app_config table directly
    const { data: rawConfig, error: configError } = await supabase
      .from('app_config')
      .select('*')
      .eq('id', 1)
      .limit(1)
      .maybeSingle();

    return NextResponse.json({
      config: {
        mode: config.mode,
        razoterApiKey: config.razoterApiKey?.slice(0, 10) + '...',
        fullKeyLength: config.razoterApiKey?.length,
      },
      apiKeys: keys?.map(k => ({ id: k.id, name: k.name, keyPrefix: k.key?.slice(0, 10) + '...' })) || [],
      keysError: keysError?.message || null,
      rawConfig: rawConfig ? {
        razoter_api_key: rawConfig.razoter_api_key?.slice(0, 10) + '...',
        mode: rawConfig.mode,
      } : null,
      configError: configError?.message || null,
      envKeyExists: !!process.env.RAZOTER_API_KEY,
      envKeyPrefix: process.env.RAZOTER_API_KEY?.slice(0, 10) + '...' || 'not set',
      supabaseUrl: process.env.SUPABASE_URL?.slice(0, 30) + '...' || 'not set',
      supabaseKeyExists: !!process.env.SUPABASE_SERVICE_KEY,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message, stack: e.stack?.slice(0, 500) });
  }
}
