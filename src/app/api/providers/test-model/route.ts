import { NextRequest, NextResponse } from 'next/server';
import { verifyDashboardAuth } from '@/lib/auth';
import { getProvider } from '@/lib/storage';
import { withCors, handleCorsPreflight } from '@/lib/cors';

export async function OPTIONS() {
  return handleCorsPreflight();
}

/**
 * POST /api/providers/test-model
 * Test a single model by sending a minimal chat completion request.
 * Body: { baseUrl, apiKey, model }
 * Returns: { success, latencyMs, error? }
 */
export async function POST(request: NextRequest) {
  if (!await verifyDashboardAuth(request)) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  try {
    const body = await request.json();
    const { baseUrl, apiKey, model, providerId } = body;

    if (!baseUrl || !model) {
      return withCors(
        NextResponse.json(
          { error: 'Missing required fields: baseUrl, model' },
          { status: 400 }
        )
      );
    }

    // Resolve API key
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
      const res = await fetch(`${cleanUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resolvedApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 5,
        }),
        signal: AbortSignal.timeout(30000),
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
            model,
            latencyMs,
            error: errorMsg,
            statusCode: res.status,
          })
        );
      }

      const data = await res.json();
      return withCors(
        NextResponse.json({
          success: true,
          model,
          latencyMs,
        })
      );
    } catch (fetchError: any) {
      const latencyMs = Date.now() - startTime;
      const isTimeout = fetchError.name === 'AbortError' || fetchError.name === 'TimeoutError';

      return withCors(
        NextResponse.json({
          success: false,
          model,
          latencyMs,
          error: isTimeout ? 'Request timed out (30s)' : fetchError.message,
        })
      );
    }
  } catch {
    return withCors(NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }));
  }
}
