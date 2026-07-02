import { NextRequest, NextResponse } from 'next/server';
import { verifyDashboardAuth } from '@/lib/auth';
import { getEnabledProviders, getProvider, updateProvider } from '@/lib/storage';
import { withCors, handleCorsPreflight } from '@/lib/cors';

export async function OPTIONS() {
  return handleCorsPreflight();
}

/**
 * GET /api/health — Check health of all enabled providers
 * GET /api/health?id=xxx — Check health of a specific provider
 */
export async function GET(request: NextRequest) {
  if (!await verifyDashboardAuth(request)) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  const providerId = request.nextUrl.searchParams.get('id');

  let providers;
  if (providerId) {
    const p = await getProvider(providerId);
    providers = p ? [p] : [];
  } else {
    providers = await getEnabledProviders();
  }

  const results = await Promise.allSettled(
    providers.map(async (provider) => {
      const startTime = Date.now();
      try {
        const baseUrl = provider.baseUrl.replace(/\/+$/, '');
        const res = await fetch(`${baseUrl}/models`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${provider.apiKey}` },
          signal: AbortSignal.timeout(10000),
        });
        const latency = Date.now() - startTime;
        
        const status = res.ok ? 'healthy' : 'degraded';
        await updateProvider(provider.id, { 
          healthStatus: status,
          lastHealthCheck: new Date().toISOString(),
        });
        
        return {
          providerId: provider.id,
          providerName: provider.name,
          status,
          latencyMs: latency,
          statusCode: res.status,
        };
      } catch (error: any) {
        const latency = Date.now() - startTime;
        await updateProvider(provider.id, { 
          healthStatus: 'down',
          lastHealthCheck: new Date().toISOString(),
        });
        return {
          providerId: provider.id,
          providerName: provider.name,
          status: 'down' as const,
          latencyMs: latency,
          error: error.message,
        };
      }
    })
  );

  const healthResults = results.map(r =>
    r.status === 'fulfilled' ? r.value : { status: 'error', error: 'Check failed' }
  );

  return withCors(NextResponse.json({ health: healthResults }));
}
