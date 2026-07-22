import { NextRequest, NextResponse } from 'next/server';
import { verifyDashboardAuth } from '@/lib/auth';
import { getLogs, getProviders } from '@/lib/storage';
import { Stats } from '@/lib/types';
import { withCors, handleCorsPreflight } from '@/lib/cors';

export async function OPTIONS() {
  return handleCorsPreflight();
}

export async function GET(request: NextRequest) {
  if (!await verifyDashboardAuth(request)) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  const logs = await getLogs(500);
  const providers = await getProviders();

  const successCount = logs.filter(l => l.status === 'success').length;
  const errorCount = logs.filter(l => l.status === 'error' || l.status === 'timeout').length;
  const totalRequests = logs.length;
  const avgLatency = totalRequests > 0
    ? Math.round(logs.reduce((sum, l) => sum + l.latencyMs, 0) / totalRequests)
    : 0;

  const providerBreakdown = providers.map(p => {
    const pLogs = logs.filter(l => l.providerId === p.id);
    const pSuccesses = pLogs.filter(l => l.status === 'success').length;
    const totalTokens = pLogs.reduce((sum, l) => sum + (l.tokensUsed || 0), 0);
    return {
      providerId: p.id,
      providerName: p.name,
      requests: pLogs.length,
      successes: pSuccesses,
      errors: pLogs.length - pSuccesses,
      avgLatency: pLogs.length > 0
        ? Math.round(pLogs.reduce((sum, l) => sum + l.latencyMs, 0) / pLogs.length)
        : 0,
      totalTokens,
    };
  });

  // Token tracker: by provider / model / API key (from recent logs window)
  type Agg = { key: string; tokens: number; requests: number; successes: number };
  const providerMap = new Map<string, Agg>();
  const modelMap = new Map<string, Agg>();
  const apiKeyMap = new Map<string, Agg>();
  const comboMap = new Map<string, Agg>(); // model + api key pair
  let totalTokensAll = 0;

  for (const l of logs) {
    const tokens = l.tokensUsed || 0;
    const providerName = (l.providerName || '').trim() || '(unknown provider)';
    const model = (l.model || '').trim() || '(unknown model)';
    const apiKeyName = (l.apiKeyName || '').trim() || 'Default';
    const ok = l.status === 'success';
    totalTokensAll += tokens;

    const p = providerMap.get(providerName) || { key: providerName, tokens: 0, requests: 0, successes: 0 };
    p.tokens += tokens;
    p.requests += 1;
    if (ok) p.successes += 1;
    providerMap.set(providerName, p);

    const m = modelMap.get(model) || { key: model, tokens: 0, requests: 0, successes: 0 };
    m.tokens += tokens;
    m.requests += 1;
    if (ok) m.successes += 1;
    modelMap.set(model, m);

    const k = apiKeyMap.get(apiKeyName) || { key: apiKeyName, tokens: 0, requests: 0, successes: 0 };
    k.tokens += tokens;
    k.requests += 1;
    if (ok) k.successes += 1;
    apiKeyMap.set(apiKeyName, k);

    const pairKey = `${model}|||${apiKeyName}`;
    const c = comboMap.get(pairKey) || { key: pairKey, tokens: 0, requests: 0, successes: 0 };
    c.tokens += tokens;
    c.requests += 1;
    if (ok) c.successes += 1;
    comboMap.set(pairKey, c);
  }

  const sortByTokens = (a: Agg, b: Agg) => b.tokens - a.tokens || b.requests - a.requests;

  const tokenByProvider = [...providerMap.values()].sort(sortByTokens);
  const tokenByModel = [...modelMap.values()].sort(sortByTokens);
  const tokenByApiKey = [...apiKeyMap.values()].sort(sortByTokens);
  const tokenByModelAndKey = [...comboMap.values()]
    .map(row => {
      const [model, apiKeyName] = row.key.split('|||');
      return { model, apiKeyName, tokens: row.tokens, requests: row.requests, successes: row.successes };
    })
    .sort((a, b) => b.tokens - a.tokens || b.requests - a.requests);

  const stats: Stats & {
    totalTokens: number;
    tokenByProvider: typeof tokenByProvider;
    tokenByModel: typeof tokenByModel;
    tokenByApiKey: typeof tokenByApiKey;
    tokenByModelAndKey: typeof tokenByModelAndKey;
  } = {
    totalRequests,
    successCount,
    errorCount,
    successRate: totalRequests > 0 ? Math.round((successCount / totalRequests) * 100) : 0,
    avgLatency,
    providerBreakdown,
    totalTokens: totalTokensAll,
    tokenByProvider,
    tokenByModel,
    tokenByApiKey,
    tokenByModelAndKey,
  };

  return withCors(NextResponse.json(stats));
}
