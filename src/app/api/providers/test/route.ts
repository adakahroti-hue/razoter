import { NextRequest, NextResponse } from 'next/server';
import { verifyDashboardAuth } from '@/lib/auth';
import { getProvider } from '@/lib/storage';
import { withCors, handleCorsPreflight } from '@/lib/cors';

export async function OPTIONS() {
  return handleCorsPreflight();
}

/**
 * POST /api/providers/test
 * Test connection to a provider and fetch available models.
 * Body: { baseUrl, apiKey }
 * Returns: { success, models[], latencyMs, error? }
 */
export async function POST(request: NextRequest) {
  if (!await verifyDashboardAuth(request)) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  try {
    const body = await request.json();
    const { baseUrl, apiKey, providerId } = body;

    if (!baseUrl) {
      return withCors(
        NextResponse.json(
          { error: 'Missing required field: baseUrl' },
          { status: 400 }
        )
      );
    }

    // Resolve API key: use provided key or look up from stored provider
    let resolvedApiKey = apiKey;
    if (!resolvedApiKey && providerId) {
      const provider = await getProvider(providerId);
      if (!provider) {
        return withCors(NextResponse.json({ error: 'Provider not found' }, { status: 404 }));
      }
      resolvedApiKey = provider.apiKey;
    }
    if (!resolvedApiKey) {
      return withCors(NextResponse.json({ error: 'No API key provided or stored' }, { status: 400 }));
    }

    const cleanUrl = baseUrl.replace(/\/+$/, '');
    const startTime = Date.now();

    try {
      const res = await fetch(`${cleanUrl}/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${resolvedApiKey}`,
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

        return withCors(
          NextResponse.json({
            success: false,
            models: [],
            latencyMs,
            error: errorMsg,
            statusCode: res.status,
          })
        );
      }

      const data = await res.json();
      const models: string[] = (data.data || data.models || [])
        .map((m: any) => m.id || m.name)
        .filter(Boolean)
        .sort();

      return withCors(
        NextResponse.json({
          success: true,
          models,
          latencyMs,
          modelCount: models.length,
        })
      );
    } catch (fetchError: any) {
      const latencyMs = Date.now() - startTime;
      const isTimeout = fetchError.name === 'AbortError' || fetchError.name === 'TimeoutError';

      return withCors(
        NextResponse.json({
          success: false,
          models: [],
          latencyMs,
          error: isTimeout ? 'Connection timed out (15s)' : fetchError.message,
        })
      );
    }
  } catch {
    return withCors(NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }));
  }
}
