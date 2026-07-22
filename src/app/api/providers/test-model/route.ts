import { NextRequest, NextResponse } from 'next/server';
import { verifyDashboardAuth } from '@/lib/auth';
import { getProvider } from '@/lib/storage';
import { withCors, handleCorsPreflight } from '@/lib/cors';
import { getValidAccessToken, CODEX_BASE_URL } from '@/lib/chatgpt-auth';

export async function OPTIONS() {
  return handleCorsPreflight();
}

/**
 * POST /api/providers/test-model
 * Test a single model by sending a minimal request.
 * Supports both standard OpenAI and ChatGPT Plus (Codex) providers.
 * Intentionally does NOT write to request_logs — dashboard model tests
 * should not pollute the Logs tab.
 */
export async function POST(request: NextRequest) {
  if (!await verifyDashboardAuth(request)) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  try {
    const body = await request.json();
    const { baseUrl, apiKey, apiKeyName, model, providerId } = body;

    if (!model) {
      return withCors(
        NextResponse.json({ error: 'Missing required field: model' }, { status: 400 })
      );
    }

    // Resolve provider info
    let resolvedApiKey = apiKey;
    let resolvedBaseUrl = baseUrl;
    let isChatgptPlus = false;
    let refreshToken: string | undefined;
    let expiresAt: string | undefined;

    if (providerId) {
      const provider = await getProvider(providerId);
      if (!provider) {
        return withCors(NextResponse.json({ error: 'Provider not found' }, { status: 404 }));
      }
      resolvedApiKey = resolvedApiKey || provider.apiKey;
      resolvedBaseUrl = resolvedBaseUrl || provider.baseUrl;
      isChatgptPlus = provider.authType === 'chatgpt_plus';
      refreshToken = provider.chatgptRefreshToken;
      expiresAt = provider.chatgptExpiresAt;
    }

    if (!resolvedBaseUrl) {
      return withCors(NextResponse.json({ error: 'No base URL provided' }, { status: 400 }));
    }

    // Auto-refresh ChatGPT Plus token if needed
    if (isChatgptPlus && refreshToken && expiresAt) {
      try {
        const refreshed = await getValidAccessToken(resolvedApiKey, refreshToken, expiresAt);
        resolvedApiKey = refreshed.accessToken;
        // Update tokens in background
        if (refreshed.refreshed) {
          import('@/lib/storage').then(({ updateProvider }) =>
            updateProvider(providerId!, {
              apiKey: refreshed.accessToken,
              chatgptRefreshToken: refreshed.refreshToken,
              chatgptExpiresAt: refreshed.expiresAt,
            })
          ).catch(() => {});
        }
      } catch (refreshErr: unknown) {
        const msg = refreshErr instanceof Error ? refreshErr.message : 'Token refresh failed';
        return withCors(NextResponse.json({
          success: false,
          model,
          latencyMs: 0,
          error: `Token refresh failed: ${msg}`,
        }));
      }
    }

    const startTime = Date.now();

    if (isChatgptPlus) {
      // ChatGPT Plus uses /responses API (stream-only)
      try {
        const resp = await fetch(`${CODEX_BASE_URL}/responses`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resolvedApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            input: [{ role: 'user', content: 'hi' }],
            store: false,
            stream: true,
          }),
          signal: AbortSignal.timeout(30000),
        });

        const latencyMs = Date.now() - startTime;

        if (!resp.ok) {
          const errText = await resp.text();
          return withCors(NextResponse.json({
            success: false,
            model,
            latencyMs,
            error: `HTTP ${resp.status}: ${errText.slice(0, 200)}`,
            statusCode: resp.status,
          }));
        }

        // Verify we got valid streaming data
        const reader = resp.body?.getReader();
        if (reader) {
          const decoder = new TextDecoder();
          const { value } = await reader.read();
          reader.cancel();
          const chunk = decoder.decode(value);
          if (chunk.includes('response.output_text') || chunk.includes('response.created')) {
            return withCors(NextResponse.json({ success: true, model, latencyMs }));
          }
        }

        return withCors(NextResponse.json({
          success: false,
          model,
          latencyMs,
          error: 'Unexpected response format',
        }));
      } catch (fetchError: any) {
        const latencyMs = Date.now() - startTime;
        const isTimeout = fetchError.name === 'AbortError' || fetchError.name === 'TimeoutError';
        const errorMsg = isTimeout ? 'Request timed out (30s)' : fetchError.message;
        return withCors(NextResponse.json({
          success: false,
          model,
          latencyMs,
          error: errorMsg,
        }));
      }
    }

    // Standard OpenAI-compatible provider
    const cleanUrl = (resolvedBaseUrl || '').replace(/\/+$/, '');
    if (!cleanUrl) {
      return withCors(NextResponse.json({ error: 'No base URL provided' }, { status: 400 }));
    }
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
          NextResponse.json({ success: false, model, latencyMs, error: errorMsg, statusCode: res.status })
        );
      }

      return withCors(NextResponse.json({ success: true, model, latencyMs }));
    } catch (fetchError: any) {
      const latencyMs = Date.now() - startTime;
      const isTimeout = fetchError.name === 'AbortError' || fetchError.name === 'TimeoutError';
      const errorMsg = isTimeout ? 'Request timed out (30s)' : fetchError.message;
      return withCors(NextResponse.json({
        success: false,
        model,
        latencyMs,
        error: errorMsg,
      }));
    }
  } catch {
    return withCors(NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }));
  }
}
