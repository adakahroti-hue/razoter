import { NextRequest, NextResponse } from 'next/server';
import { verifyApiKey } from '@/lib/auth';
import { selectProvider, getNextProvider } from '@/lib/rotation';
import { getConfig, addLog, updateProviderStats, getEnabledProviders } from '@/lib/storage';

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  // Verify API key
  if (!verifyApiKey(request)) {
    return NextResponse.json(
      { error: { message: 'Invalid API key', type: 'auth_error', code: 'invalid_api_key' } },
      { status: 401 }
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { message: 'Invalid JSON body', type: 'invalid_request_error' } },
      { status: 400 }
    );
  }

  if (!body.model || !body.messages) {
    return NextResponse.json(
      { error: { message: 'Missing required fields: model, messages', type: 'invalid_request_error' } },
      { status: 400 }
    );
  }

  const config = getConfig();
  const enabledProviders = getEnabledProviders();
  
  if (enabledProviders.length === 0) {
    return NextResponse.json(
      { error: { message: 'No enabled providers configured', type: 'server_error' } },
      { status: 503 }
    );
  }

  const triedIds = new Set<string>();
  let currentProvider = selectProvider(config.mode);
  let lastError: any = null;

  for (let attempt = 0; attempt < config.maxRetries && currentProvider; attempt++) {
    triedIds.add(currentProvider.id);
    const attemptStart = Date.now();

    try {
      const upstreamUrl = `${currentProvider.baseUrl.replace(/\/$/, '')}/chat/completions`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

      const upstreamResponse = await fetch(upstreamUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentProvider.apiKey}`,
        },
        body: JSON.stringify({
          ...body,
          model: currentProvider.model || body.model,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const latencyMs = Date.now() - attemptStart;

      if (upstreamResponse.ok) {
        const data = await upstreamResponse.json();
        updateProviderStats(currentProvider.id, true, latencyMs);
        addLog({
          providerId: currentProvider.id,
          providerName: currentProvider.name,
          model: body.model,
          status: 'success',
          statusCode: 200,
          latencyMs,
          tokensUsed: data.usage?.total_tokens,
        });

        return NextResponse.json(data, { status: 200 });
      }

      // Retryable errors: 429, 500, 502, 503, 504
      const statusCode = upstreamResponse.status;
      const errorText = await upstreamResponse.text();
      let errorBody: any;
      try { errorBody = JSON.parse(errorText); } catch { errorBody = { message: errorText }; }

      updateProviderStats(currentProvider.id, false, latencyMs);
      addLog({
        providerId: currentProvider.id,
        providerName: currentProvider.name,
        model: body.model,
        status: statusCode === 429 ? 'retry' : 'error',
        statusCode,
        latencyMs,
        errorMessage: errorBody?.error?.message || errorBody?.message || `HTTP ${statusCode}`,
      });

      // Non-retryable client errors (4xx except 429)
      if (statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
        return NextResponse.json(errorBody, { status: statusCode });
      }

      lastError = errorBody;

    } catch (error: any) {
      const latencyMs = Date.now() - attemptStart;
      const isTimeout = error.name === 'AbortError';
      
      updateProviderStats(currentProvider.id, false, latencyMs);
      addLog({
        providerId: currentProvider.id,
        providerName: currentProvider.name,
        model: body.model,
        status: isTimeout ? 'timeout' : 'error',
        latencyMs,
        errorMessage: isTimeout ? 'Request timed out' : error.message,
      });

      lastError = { message: isTimeout ? 'Request timed out' : error.message };
    }

    // Get next provider for retry
    const next = getNextProvider(config.mode, currentProvider.id, triedIds);
    if (!next) break;
    currentProvider = next;
  }

  // All providers failed
  const totalLatency = Date.now() - startTime;
  return NextResponse.json(
    {
      error: {
        message: `All providers failed after ${triedIds.size} attempts. Last error: ${lastError?.message || 'Unknown'}`,
        type: 'server_error',
        code: 'all_providers_failed',
      },
    },
    { status: 502 }
  );
}

// Also handle GET for compatibility check
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'Razoter',
    version: '1.0.0',
    endpoint: '/api/v1/chat/completions',
  });
}
