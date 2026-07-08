import { NextRequest, NextResponse } from 'next/server';
import { verifyApiKey } from '@/lib/auth';
import { selectProvider, getNextProvider, pickModel } from '@/lib/rotation';
import { getConfig, addLog, updateProviderStats, updateProviderRateLimit, getEnabledProviders, checkRateLimit, resolveComboModel, getProvider, checkQuotaLimit, incrementQuotaUsage } from '@/lib/storage';
import { withCors, handleCorsPreflight, corsHeaders } from '@/lib/cors';
import { getValidAccessToken } from '@/lib/chatgpt-auth';
import { handleChatgptPlusRequest } from '@/lib/chatgpt-proxy';

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


/** Pick an API key based on provider's apiKeyStrategy setting.
 *  triedKeyNames: names of keys already tried and failed (for failover-priority). */
function pickApiKey(provider: any, triedKeyNames?: Set<string>): { key: string; name: string } {
  const keys = provider.apiKeys;
  const strategy = provider.apiKeyStrategy || 'random';
  if (Array.isArray(keys) && keys.length > 0) {
    let enabled = keys.filter((k: any) => k.enabled !== false);
    if (enabled.length > 0) {
      // For failover-priority, skip already-tried keys
      if (strategy === 'failover-priority' && triedKeyNames && triedKeyNames.size > 0) {
        const remaining = enabled.filter((k: any) => !triedKeyNames.has(k.name));
        if (remaining.length > 0) enabled = remaining;
      }
      if (strategy === 'failover-priority') {
        // Always pick the first enabled key (priority order)
        return { key: enabled[0].key, name: enabled[0].name };
      }
      if (strategy === 'round-robin') {
        // Use per-provider round-robin index
        const providerRoundRobinKey = `apikey_rr_${provider.id}`;
        const idx = apiKeyRoundRobinIndex.get(providerRoundRobinKey) ?? 0;
        const pick = enabled[idx % enabled.length];
        apiKeyRoundRobinIndex.set(providerRoundRobinKey, idx + 1);
        return { key: pick.key, name: pick.name };
      }
      // Default: random
      const pick = enabled[Math.floor(Math.random() * enabled.length)];
      return { key: pick.key, name: pick.name };
    }
  }
  return { key: provider.apiKey, name: 'Default' };
}

// In-memory round-robin index for API key selection (not persisted)
const apiKeyRoundRobinIndex = new Map<string, number>();

/** Resolve a valid access token for a provider, refreshing if needed.
 *  triedKeyNames: names of keys already tried (for failover-priority multi-key failover). */
async function resolveAccessToken(provider: any, triedKeyNames?: Set<string>): Promise<{ header: string; refreshed: boolean; newTokens?: any; apiKeyName: string }> {
  if (provider.authType === 'chatgpt_plus' && provider.chatgptRefreshToken && provider.chatgptExpiresAt) {
    const ak = pickApiKey(provider, triedKeyNames);
    try {
      const r = await getValidAccessToken(
        ak.key,
        provider.chatgptRefreshToken,
        provider.chatgptExpiresAt,
      );
      return {
        header: `Bearer ${r.accessToken}`,
        refreshed: r.refreshed,
        newTokens: r.refreshed ? { apiKey: r.accessToken, chatgptRefreshToken: r.refreshToken, chatgptExpiresAt: r.expiresAt } : undefined,
        apiKeyName: ak.name,
      };
    } catch (refreshErr: any) {
      // Fall through with stale token
      await addLog({
        providerId: provider.id,
        providerName: provider.name,
        model: '',
        status: 'error',
        latencyMs: 0,
        errorMessage: `Token refresh failed: ${refreshErr.message}`,
        apiKeyName: ak.name,
      });
    }
  }
  const fallback = pickApiKey(provider, triedKeyNames);
  return { header: `Bearer ${fallback.key}`, refreshed: false, apiKeyName: fallback.name };
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

  // ─── Combo resolution (with internal failover) ────────
  if (requestedModel) {
    const comboTriedIndices: number[] = [];
    const maxComboAttempts = 5;

    for (let comboAttempt = 0; comboAttempt < maxComboAttempts; comboAttempt++) {
      const comboResult = await resolveComboModel(requestedModel, comboTriedIndices);
      if (!comboResult) break;

      const comboProvider = await getProvider(comboResult.providerId);
      if (!comboProvider || !comboProvider.enabled) {
        comboTriedIndices.push(comboResult.itemIndex);
        continue;
      }

      body.model = comboResult.model;

      let comboKeyName = 'Default';
      const comboStart = Date.now();
      try {
        if (comboProvider.authType === 'chatgpt_plus') {
          const { header: comboAuth, refreshed, newTokens, apiKeyName: comboKeyName } = await resolveAccessToken(comboProvider);
          if (refreshed && newTokens) {
            import('@/lib/storage').then(({ updateProvider }) =>
              updateProvider(comboProvider!.id, newTokens as any)
            ).catch(() => {});
          }
          const accessToken = comboAuth.replace('Bearer ', '');
          const { response: cgptResp, tokensUsed } = await handleChatgptPlusRequest(
            accessToken, body, comboResult.model, isStreaming
          );
          const latencyMs = Date.now() - comboStart;
          import('@/lib/storage').then(({ addLog, updateProviderStats, incrementQuotaUsage }) => {
            addLog({ providerId: comboProvider!.id, providerName: comboProvider!.name, model: comboResult.model, status: 'success', latencyMs, tokensUsed, apiKeyName: comboKeyName });
            updateProviderStats(comboProvider!.id, true, latencyMs);
            incrementQuotaUsage(comboProvider!.id, tokensUsed || 0, comboKeyName).catch(() => {});
          }).catch(() => {});
          return cgptResp;
        }

        const upstreamUrl = `${comboProvider.baseUrl.replace(/\/+$/, '')}/chat/completions`;
        const { header: comboAuth, apiKeyName: comboKeyName } = await resolveAccessToken(comboProvider);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

        const upstreamResponse = await fetch(upstreamUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': comboAuth },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        const latencyMs = Date.now() - comboStart;

        if (upstreamResponse.ok) {
          if (isStreaming && upstreamResponse.body) {
            await updateProviderStats(comboProvider.id, true, latencyMs);

            // Intercept stream to extract token usage, then update quota
            const reader = upstreamResponse.body.getReader();
            const stream = new ReadableStream({
              async start(controller) {
                let lastUsage: number | undefined;
                const decoder = new TextDecoder();
                let buffer = '';
                try {
                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    for (const line of lines) {
                      if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                        try {
                          const json = JSON.parse(line.slice(6));
                          if (json.usage?.total_tokens) lastUsage = json.usage.total_tokens;
                        } catch {}
                      }
                    }
                    controller.enqueue(value);
                  }
                } finally {
                  controller.close();
                  if (lastUsage) {
                    import('@/lib/storage').then(({ incrementQuotaUsage }) =>
                      incrementQuotaUsage(comboProvider!.id, lastUsage!, comboKeyName).catch(() => {})
                    ).catch(() => {});
                  }
                }
              }
            });

            await addLog({ providerId: comboProvider.id, providerName: comboProvider.name, model: comboResult.model, status: 'success', statusCode: 200, latencyMs, apiKeyName: comboKeyName });
            return new NextResponse(stream, {
              status: 200,
              headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', ...corsHeaders() },
            });
          }
          const data = await upstreamResponse.json();
          await updateProviderStats(comboProvider.id, true, latencyMs);
          await addLog({ providerId: comboProvider.id, providerName: comboProvider.name, model: comboResult.model, status: 'success', statusCode: 200, latencyMs, tokensUsed: data.usage?.total_tokens, apiKeyName: comboKeyName });
          if (data.usage?.total_tokens) {
            await incrementQuotaUsage(comboProvider.id, data.usage.total_tokens, comboKeyName);
          }
          return withCors(NextResponse.json(data, { status: 200 }));
        }

        const errText = await upstreamResponse.text();
        let parsedError = errText;
        try { parsedError = JSON.parse(errText)?.error?.message || errText; } catch {}
        await updateProviderStats(comboProvider.id, false, latencyMs);
        await addLog({ providerId: comboProvider.id, providerName: comboProvider.name, model: comboResult.model, status: 'retry', statusCode: upstreamResponse.status, latencyMs, errorMessage: parsedError + '. Combo failover -> next item.', apiKeyName: comboKeyName });
      } catch (err: any) {
        const latencyMs = Date.now() - comboStart;
        await updateProviderStats(comboProvider.id, false, latencyMs);
        await addLog({ providerId: comboProvider.id, providerName: comboProvider.name, model: comboResult.model, status: 'retry', latencyMs, errorMessage: err.message + '. Combo failover -> next item.', apiKeyName: comboKeyName });
      }

      comboTriedIndices.push(comboResult.itemIndex);
    }

    return withCors(
      NextResponse.json(
        { error: { message: `Combo model '${requestedModel}' failed: all items exhausted or provider disabled.`, type: 'server_error' } },
        { status: 502 }
      )
    );
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
      const next = await getNextProvider(config.mode, currentProvider.id, triedIds);
      if (next) { currentProvider = next; attempt--; continue; }
      break;
    }

    const selectedModel = pickModel(currentProvider, requestedModel);
    let lastAkName: string | undefined;

    try {
      // ChatGPT Plus uses /responses API with translator
      const isChatgptPlus = currentProvider.authType === 'chatgpt_plus';

      if (isChatgptPlus) {
        const { header: authHeader, refreshed, newTokens, apiKeyName: akName } = await resolveAccessToken(currentProvider);
        lastAkName = akName;
        if (refreshed && newTokens) {
          import('@/lib/storage').then(({ updateProvider }) =>
            updateProvider(currentProvider!.id, newTokens as any)
          ).catch(() => {});
        }
        const accessToken = authHeader.replace('Bearer ', '');
        const { response: cgptResp, tokensUsed } = await handleChatgptPlusRequest(
          accessToken, body, selectedModel || requestedModel, isStreaming
        );
        // Log success
        const latencyMs = Date.now() - startTime;
        import('@/lib/storage').then(({ addLog, updateProviderStats, incrementQuotaUsage }) => {
          addLog({ providerId: currentProvider!.id, providerName: currentProvider!.name, model: selectedModel || requestedModel, status: 'success', latencyMs, tokensUsed, apiKeyName: akName });
          updateProviderStats(currentProvider!.id, true, latencyMs);
          incrementQuotaUsage(currentProvider!.id, tokensUsed || 0, akName).catch(() => {});
        }).catch(() => {});
        return cgptResp;
      }

      // Standard OpenAI-compatible provider
      const upstreamUrl = `${currentProvider.baseUrl.replace(/\/+$/, '')}/chat/completions`;
      const { header: authHeader, apiKeyName: stdAkName } = await resolveAccessToken(currentProvider);
      lastAkName = stdAkName;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

      const upstreamResponse = await fetch(upstreamUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader,
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

          // Intercept stream to extract token usage from last chunk, then update quota
          const reader = upstreamResponse.body.getReader();
          const stream = new ReadableStream({
            async start(controller) {
              let lastUsage: number | undefined;
              const decoder = new TextDecoder();
              let buffer = '';
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  buffer += decoder.decode(value, { stream: true });
                  // Look for usage in chunks
                  const lines = buffer.split('\n');
                  buffer = lines.pop() || '';
                  for (const line of lines) {
                    if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                      try {
                        const json = JSON.parse(line.slice(6));
                        if (json.usage?.total_tokens) lastUsage = json.usage.total_tokens;
                      } catch {}
                    }
                  }
                  controller.enqueue(value);
                }
                // Process final buffer
                const finalLines = buffer.split('\n');
                for (const line of finalLines) {
                  if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                    try {
                      const json = JSON.parse(line.slice(6));
                      if (json.usage?.total_tokens) lastUsage = json.usage.total_tokens;
                    } catch {}
                  }
                }
              } finally {
                controller.close();
                // Update quota and log with token usage after stream ends
                if (lastUsage) {
                  import('@/lib/storage').then(({ incrementQuotaUsage }) =>
                    incrementQuotaUsage(currentProvider!.id, lastUsage!, stdAkName).catch(() => {})
                  ).catch(() => {});
                }
              }
            }
          });

          await addLog({
            providerId: currentProvider.id,
            providerName: currentProvider.name,
            model: selectedModel || requestedModel,
            status: 'success',
            statusCode: 200,
            latencyMs,
            apiKeyName: stdAkName,
          });

          const response = new NextResponse(stream, {
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
          apiKeyName: stdAkName,
        });

        if (data.usage?.total_tokens) {
          await incrementQuotaUsage(currentProvider.id, data.usage.total_tokens, stdAkName);
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
          apiKeyName: stdAkName,
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
        apiKeyName: stdAkName,
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
        apiKeyName: lastAkName,
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
