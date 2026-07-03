import { NextRequest, NextResponse } from 'next/server';
import { verifyApiKey } from '@/lib/auth';
import { selectProvider, getNextProvider, pickModel } from '@/lib/rotation';
import { getConfig, addLog, updateProviderStats, updateProviderRateLimit, getEnabledProviders, checkRateLimit, resolveComboModel, getProvider, checkQuotaLimit, incrementQuotaUsage } from '@/lib/storage';
import { withCors, handleCorsPreflight, corsHeaders } from '@/lib/cors';

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

function parseRateLimitHeaders(headers: Headers) {
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
  if (!await verifyApiKey(request)) {
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

  if (!body.messages) {
    return withCors(
      NextResponse.json(
        { error: { message: 'Missing required field: messages', type: 'invalid_request_error' } },
        { status: 400 }
      )
    );
  }

  const requestedModel = body.model || '';
  const isStreaming = body.stream === true;
  const config = await getConfig();

  // ─── Combo resolution ────────────────────────────────
  // If the requested model matches a combo name, resolve it
  // to a specific provider+model first.
  let comboResolved = false;
  if (requestedModel) {
    const comboResult = await resolveComboModel(requestedModel);
    if (comboResult) {
      const comboProvider = await getProvider(comboResult.providerId);
      if (comboProvider && comboProvider.enabled) {
        // Directly use this provider+model, skip normal rotation
        body.model = comboResult.model;
        comboResolved = true;
        
        // Log and forward to the resolved provider
        const startTime = Date.now();
        try {
          const upstreamUrl = `${comboProvider.baseUrl.replace(/\/+$/, '')}/chat/completions`;
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

          const upstreamResponse = await fetch(upstreamUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${comboProvider.apiKey}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);
          const latencyMs = Date.now() - startTime;

          if (upstreamResponse.ok) {
            if (isStreaming && upstreamResponse.body) {
              await updateProviderStats(comboProvider.id, true, latencyMs);
              await addLog({ providerId: comboProvider.id, providerName: comboProvider.name, model: comboResult.model, status: 'success', statusCode: 200, latencyMs });
              return new NextResponse(upstreamResponse.body, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', ...corsHeaders() },
              });
            }
            const data = await upstreamResponse.json();
            await updateProviderStats(comboProvider.id, true, latencyMs);
            await addLog({ providerId: comboProvider.id, providerName: comboProvider.name, model: comboResult.model, status: 'success', statusCode: 200, latencyMs, tokensUsed: data.usage?.total_tokens });
            return withCors(NextResponse.json(data, { status: 200 }));
          }

          // If the resolved provider fails, fall through to normal rotation
          const errText = await upstreamResponse.text();
          await updateProviderStats(comboProvider.id, false, latencyMs);
          await addLog({ providerId: comboProvider.id, providerName: comboProvider.name, model: comboResult.model, status: 'error', statusCode: upstreamResponse.status, latencyMs, errorMessage: `HTTP ${upstreamResponse.status}` });
        } catch (err: any) {
          const latencyMs = Date.now() - startTime;
          await updateProviderStats(comboProvider.id, false, latencyMs);
          await addLog({ providerId: comboProvider.id, providerName: comboProvider.name, model: comboResult.model, status: 'error', latencyMs, errorMessage: err.message });
        }
        // Fall through to normal rotation if combo resolved provider failed
      }
    }
  }

  const enabledProviders = await getEnabledProviders();
  
  if (enabledProviders.length === 0) {
    return withCors(
      NextResponse.json(
        { error: { message: 'No enabled providers configured', type: 'server_error' } },
        { status: 503 }
      )
    );
  }

  const triedIds = new Set<string>();
  let currentProvider = await selectProvider(config.mode);
  let lastError: any = null;

  for (let attempt = 0; attempt < config.maxRetries && currentProvider; attempt++) {
    triedIds.add(currentProvider.id);
    const attemptStart = Date.now();

    // Check quota limit before trying this provider
    const withinQuota = await checkQuotaLimit(currentProvider.id);
    if (!withinQuota) {
      // Skip this provider, try next
      const next = await getNextProvider(config.mode, currentProvider.id, triedIds);
      if (next) { currentProvider = next; attempt--; continue; }
      break;
    }

    // Pick the best model from this provider's selected models
    const selectedModel = pickModel(currentProvider, requestedModel);

    try {
      const upstreamUrl = `${currentProvider.baseUrl.replace(/\/+$/, '')}/chat/completions`;
      
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
          model: selectedModel || requestedModel,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const latencyMs = Date.now() - attemptStart;

      const rl = parseRateLimitHeaders(upstreamResponse.headers);
      await updateProviderRateLimit(
        currentProvider.id,
        rl.remaining,
        rl.reset,
        rl.total
      );

      if (upstreamResponse.ok) {
        // Streaming response
        if (isStreaming && upstreamResponse.body) {
          await updateProviderStats(currentProvider.id, true, latencyMs);
          await addLog({
            providerId: currentProvider.id,
            providerName: currentProvider.name,
            model: selectedModel || requestedModel,
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
        await updateProviderStats(currentProvider.id, true, latencyMs);
        await addLog({
          providerId: currentProvider.id,
          providerName: currentProvider.name,
          model: selectedModel || requestedModel,
          status: 'success',
          statusCode: 200,
          latencyMs,
          tokensUsed: data.usage?.total_tokens,
        });

        // Track token usage for quota
        if (data.usage?.total_tokens) {
          await incrementQuotaUsage(currentProvider.id, data.usage.total_tokens);
        }

        const res = NextResponse.json(data, { status: 200 });
        res.headers.set('X-RateLimit-Limit', String(rateLimitResult.limit));
        res.headers.set('X-RateLimit-Remaining', String(rateLimitResult.remaining));
        res.headers.set('X-RateLimit-Reset', String(Math.ceil(rateLimitResult.resetAt / 1000)));
        return withCors(res);
      }

      const statusCode = upstreamResponse.status;
      
      if (statusCode === 429) {
        const retryAfter = upstreamResponse.headers.get('retry-after');
        await updateProviderStats(currentProvider.id, false, latencyMs);
        await addLog({
          providerId: currentProvider.id,
          providerName: currentProvider.name,
          model: selectedModel || requestedModel,
          status: 'retry',
          statusCode,
          latencyMs,
          errorMessage: `Rate limited. Retry-After: ${retryAfter || 'unknown'}`,
        });
        lastError = { message: `Rate limited (429) from ${currentProvider.name}` };
        
        if (isStreaming && attempt === config.maxRetries - 1) {
          const sseData = `data: ${JSON.stringify({ error: { message: lastError.message, type: 'rate_limit_error' } })}\ndata: [DONE]\n\n`;
          return new NextResponse(sseData, {
            status: 429,
            headers: { 'Content-Type': 'text/event-stream', ...corsHeaders() },
          });
        }

        const next = await getNextProvider(config.mode, currentProvider.id, triedIds);
        if (!next) break;
        currentProvider = next;
        continue;
      }

      const errorText = await upstreamResponse.text();
      let errorBody: any;
      try { errorBody = JSON.parse(errorText); } catch { errorBody = { message: errorText }; }

      await updateProviderStats(currentProvider.id, false, latencyMs);
      await addLog({
        providerId: currentProvider.id,
        providerName: currentProvider.name,
        model: selectedModel || requestedModel,
        status: 'error',
        statusCode,
        latencyMs,
        errorMessage: errorBody?.error?.message || errorBody?.message || `HTTP ${statusCode}`,
      });

      if (statusCode >= 400 && statusCode < 500) {
        return withCors(NextResponse.json(errorBody, { status: statusCode }));
      }

      lastError = errorBody;

    } catch (error: any) {
      const latencyMs = Date.now() - attemptStart;
      const isTimeout = error.name === 'AbortError';
      
      await updateProviderStats(currentProvider.id, false, latencyMs);
      await addLog({
        providerId: currentProvider.id,
        providerName: currentProvider.name,
        model: selectedModel || requestedModel,
        status: isTimeout ? 'timeout' : 'error',
        latencyMs,
        errorMessage: isTimeout ? 'Request timed out' : error.message,
      });

      lastError = { message: isTimeout ? 'Request timed out' : error.message };
    }

    const next = await getNextProvider(config.mode, currentProvider.id, triedIds);
    if (!next) break;
    currentProvider = next;
  }

  const errorResponse = {
    error: {
      message: `All providers failed after ${triedIds.size} attempts. Last error: ${lastError?.message || 'Unknown'}`,
      type: 'server_error',
      code: 'all_providers_failed',
    },
  };

  if (isStreaming) {
    const sseData = `data: ${JSON.stringify(errorResponse)}\ndata: [DONE]\n\n`;
    return new NextResponse(sseData, {
      status: 502,
      headers: { 'Content-Type': 'text/event-stream', ...corsHeaders() },
    });
  }

  return withCors(NextResponse.json(errorResponse, { status: 502 }));
}

export async function GET() {
  return withCors(
    NextResponse.json({
      status: 'ok',
      service: 'Razoter',
      version: '2.0.0',
      endpoint: '/api/v1/chat/completions',
    })
  );
}
