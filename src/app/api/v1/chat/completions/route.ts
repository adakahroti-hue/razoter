import { NextRequest, NextResponse } from 'next/server';
import { verifyApiKey } from '@/lib/auth';
import { selectProvider, getNextProvider } from '@/lib/rotation';
import { getConfig, addLog, updateProviderStats, updateProviderRateLimit, getEnabledProviders, checkRateLimit } from '@/lib/storage';
import { withCors, handleCorsPreflight, corsHeaders } from '@/lib/cors';

// Handle CORS preflight
export async function OPTIONS() {
  return handleCorsPreflight();
}

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    '127.0.0.1'
  );
}

function parseRateLimitHeaders(headers: Headers): {
  remaining?: number;
  reset?: number;
  total?: number;
} {
  const remaining = headers.get('x-ratelimit-remaining');
  const reset = headers.get('x-ratelimit-reset');
  const limit = headers.get('x-ratelimit-limit');
  return {
    remaining: remaining ? parseInt(remaining) : undefined,
    reset: reset ? parseInt(reset) : undefined,
    total: limit ? parseInt(limit) : undefined,
  };
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  // IP rate limiting
  const clientIp = getClientIp(request);
  const rateLimitResult = checkRateLimit(clientIp);

  if (!rateLimitResult.allowed) {
    const res = NextResponse.json(
      { error: { message: 'Rate limit exceeded. Try again later.', type: 'rate_limit_error' } },
      { status: 429 }
    );
    res.headers.set('X-RateLimit-Limit', String(rateLimitResult.limit));
    res.headers.set('X-RateLimit-Remaining', '0');
    res.headers.set('X-RateLimit-Reset', String(Math.ceil(rateLimitResult.resetAt / 1000)));
    res.headers.set('Retry-After', String(Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000)));
    return withCors(res);
  }

  // Verify API key
  if (!verifyApiKey(request)) {
    return withCors(
      NextResponse.json(
        { error: { message: 'Invalid API key', type: 'auth_error', code: 'invalid_api_key' } },
        { status: 401 }
      )
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return withCors(
      NextResponse.json(
        { error: { message: 'Invalid JSON body', type: 'invalid_request_error' } },
        { status: 400 }
      )
    );
  }

  if (!body.model || !body.messages) {
    return withCors(
      NextResponse.json(
        { error: { message: 'Missing required fields: model, messages', type: 'invalid_request_error' } },
        { status: 400 }
      )
    );
  }

  const isStreaming = body.stream === true;
  const config = getConfig();
  const enabledProviders = getEnabledProviders();
  
  if (enabledProviders.length === 0) {
    return withCors(
      NextResponse.json(
        { error: { message: 'No enabled providers configured', type: 'server_error' } },
        { status: 503 }
      )
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

      // Parse rate limit headers from provider response (for both success and 429)
      const rl = parseRateLimitHeaders(upstreamResponse.headers);
      updateProviderRateLimit(
        currentProvider.id,
        rl.remaining,
        rl.reset,
        rl.total
      );

      if (upstreamResponse.ok) {
        // Streaming response
        if (isStreaming && upstreamResponse.body) {
          updateProviderStats(currentProvider.id, true, latencyMs);
          addLog({
            providerId: currentProvider.id,
            providerName: currentProvider.name,
            model: body.model,
            status: 'success',
            statusCode: 200,
            latencyMs,
          });

          const response = new NextResponse(upstreamResponse.body, {
            status: 200,
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
              ...corsHeaders(),
              'X-RateLimit-Limit': String(rateLimitResult.limit),
              'X-RateLimit-Remaining': String(rateLimitResult.remaining),
              'X-RateLimit-Reset': String(Math.ceil(rateLimitResult.resetAt / 1000)),
            },
          });
          return response;
        }

        // Non-streaming response
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

        const res = NextResponse.json(data, { status: 200 });
        res.headers.set('X-RateLimit-Limit', String(rateLimitResult.limit));
        res.headers.set('X-RateLimit-Remaining', String(rateLimitResult.remaining));
        res.headers.set('X-RateLimit-Reset', String(Math.ceil(rateLimitResult.resetAt / 1000)));
        return withCors(res);
      }

      // Retryable errors: 429, 500, 502, 503, 504
      const statusCode = upstreamResponse.status;
      
      // Handle 429 with retry-after
      if (statusCode === 429) {
        const retryAfter = upstreamResponse.headers.get('retry-after');
        updateProviderStats(currentProvider.id, false, latencyMs);
        addLog({
          providerId: currentProvider.id,
          providerName: currentProvider.name,
          model: body.model,
          status: 'retry',
          statusCode,
          latencyMs,
          errorMessage: `Rate limited. Retry-After: ${retryAfter || 'unknown'}`,
        });
        lastError = { message: `Rate limited (429) from ${currentProvider.name}` };
        
        // If streaming and this is the last attempt, return the error as SSE
        if (isStreaming && attempt === config.maxRetries - 1) {
          const sseData = `data: ${JSON.stringify({ error: { message: lastError.message, type: 'rate_limit_error' } })}\n\ndata: [DONE]\n\n`;
          return new NextResponse(sseData, {
            status: 429,
            headers: {
              'Content-Type': 'text/event-stream',
              ...corsHeaders(),
            },
          });
        }

        // Get next provider
        const next = getNextProvider(config.mode, currentProvider.id, triedIds);
        if (!next) break;
        currentProvider = next;
        continue;
      }

      const errorText = await upstreamResponse.text();
      let errorBody: any;
      try { errorBody = JSON.parse(errorText); } catch { errorBody = { message: errorText }; }

      updateProviderStats(currentProvider.id, false, latencyMs);
      addLog({
        providerId: currentProvider.id,
        providerName: currentProvider.name,
        model: body.model,
        status: statusCode >= 500 ? 'error' : 'error',
        statusCode,
        latencyMs,
        errorMessage: errorBody?.error?.message || errorBody?.message || `HTTP ${statusCode}`,
      });

      // Non-retryable client errors (4xx except 429)
      if (statusCode >= 400 && statusCode < 500) {
        return withCors(NextResponse.json(errorBody, { status: statusCode }));
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
  const errorResponse = {
    error: {
      message: `All providers failed after ${triedIds.size} attempts. Last error: ${lastError?.message || 'Unknown'}`,
      type: 'server_error',
      code: 'all_providers_failed',
    },
  };

  if (isStreaming) {
    const sseData = `data: ${JSON.stringify(errorResponse)}\n\ndata: [DONE]\n\n`;
    return new NextResponse(sseData, {
      status: 502,
      headers: {
        'Content-Type': 'text/event-stream',
        ...corsHeaders(),
      },
    });
  }

  return withCors(NextResponse.json(errorResponse, { status: 502 }));
}

// Also handle GET for compatibility check
export async function GET() {
  return withCors(
    NextResponse.json({
      status: 'ok',
      service: 'Razoter',
      version: '1.0.0',
      endpoint: '/api/v1/chat/completions',
    })
  );
}
