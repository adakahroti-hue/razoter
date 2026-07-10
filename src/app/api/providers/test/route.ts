import { NextRequest, NextResponse } from 'next/server';
import { verifyDashboardAuth } from '@/lib/auth';
import { getProvider } from '@/lib/storage';
import { withCors, handleCorsPreflight } from '@/lib/cors';

export async function OPTIONS() {
  return handleCorsPreflight();
}

/**
 * POST /api/providers/test
 * Test connection(s) to a provider and fetch available models.
 * Body: { baseUrl, apiKey?, apiKeys?: [{name,key}], providerId? }
 * Returns: {
 *   success, models[], latencyMs, error?,
 *   keyResults: [{ name, ok, models?, latencyMs?, error?, statusCode? }]
 * }
 */
export async function POST(request: NextRequest) {
  if (!await verifyDashboardAuth(request)) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  try {
    const body = await request.json();
    const { baseUrl, apiKey, apiKeys, providerId } = body;

    if (!baseUrl) {
      return withCors(
        NextResponse.json(
          { error: 'Missing required field: baseUrl' },
          { status: 400 }
        )
      );
    }

    // Build the list of keys to test (preserve order & names from the form).
    const keyList: Array<{ name: string; key: string }> = [];
    if (Array.isArray(apiKeys)) {
      for (const k of apiKeys) {
        if (k && k.key && !k.key.includes('...')) {
          keyList.push({ name: k.name || 'Unnamed', key: k.key });
        }
      }
    }
    // Single-key (legacy / fallback) path
    if (keyList.length === 0 && apiKey && !apiKey.includes('...')) {
      keyList.push({ name: 'Default', key: apiKey });
    }
    // Editing an existing provider with no new key typed → use stored keys
    if (keyList.length === 0 && providerId) {
      const provider = await getProvider(providerId);
      if (!provider) {
        return withCors(NextResponse.json({ error: 'Provider not found' }, { status: 404 }));
      }
      if (Array.isArray(provider.apiKeys) && provider.apiKeys.length > 0) {
        for (const k of provider.apiKeys) {
          if (k && k.key) keyList.push({ name: k.name || 'Unnamed', key: k.key });
        }
      } else if (provider.apiKey) {
        keyList.push({ name: 'Default', key: provider.apiKey });
      }
    }

    if (keyList.length === 0) {
      return withCors(NextResponse.json({ error: 'No API key provided or stored' }, { status: 400 }));
    }

    const cleanUrl = baseUrl.replace(/\/+$/, '');

    const testOne = async (k: { name: string; key: string }) => {
      const startTime = Date.now();
      try {
        const res = await fetch(`${cleanUrl}/models`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${k.key}`,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(15000),
        });
        const latencyMs = Date.now() - startTime;
        if (!res.ok) {
          const errorText = await res.text();
          let errorMsg: string;
          try {
            const errJson = JSON.parse(errorText);
            errorMsg = errJson.error?.message || errJson.message || `HTTP ${res.status}`;
          } catch {
            errorMsg = `HTTP ${res.status}: ${errorText.slice(0, 200)}`;
          }
          return { name: k.name, ok: false, latencyMs, error: errorMsg, statusCode: res.status };
        }
        const data = await res.json();
        const models: string[] = (data.data || data.models || [])
          .map((m: any) => m.id || m.name)
          .filter(Boolean)
          .sort();
        return { name: k.name, ok: true, latencyMs, models, modelCount: models.length };
      } catch (fetchError: any) {
        const latencyMs = Date.now() - startTime;
        const isTimeout = fetchError.name === 'AbortError' || fetchError.name === 'TimeoutError';
        return {
          name: k.name,
          ok: false,
          latencyMs,
          error: isTimeout ? 'Connection timed out (15s)' : fetchError.message,
        };
      }
    };

    const keyResults = await Promise.all(keyList.map(testOne));

    // Use models from the first successful key
    const firstOk = keyResults.find(r => r.ok);
    const models = firstOk?.models || [];
    const anyOk = !!firstOk;

    return withCors(
      NextResponse.json({
        success: anyOk,
        models,
        latencyMs: keyResults.reduce((s, r) => s + (r.latencyMs || 0), 0),
        keyResults,
      })
    );
  } catch {
    return withCors(NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }));
  }
}
