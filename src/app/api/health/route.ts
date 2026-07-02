import { NextRequest, NextResponse } from 'next/server';
import { verifyDashboardAuth } from '@/lib/auth';
import { getEnabledProviders, updateProvider } from '@/lib/storage';
import { withCors, handleCorsPreflight } from '@/lib/cors';

export async function OPTIONS() {
  return handleCorsPreflight();
}

export async function GET(request: NextRequest) {
  if (!await verifyDashboardAuth(request)) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  const providers = await getEnabledProviders();
  const results = await Promise.allSettled(
    providers.map(async (provider) => {
      const startTime = Date.now();
      try {
        const baseUrl = provider.baseUrl.replace(/\/$/, '');
        // Try the models endpoint first, then base
        const res = await fetch(`${baseUrl}/models`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${provider.apiKey}` },
          signal: AbortSignal.timeout(10000),
        });
        const latency = Date.now() - startTime;
        
        const status = res.ok ? 'healthy' : 'degraded';
        await updateProvider(provider.id, { healthStatus: status });
        
        return {
          providerId: provider.id,
          providerName: provider.name,
          status,
          latencyMs: latency,
          statusCode: res.status,
        };
      } catch (error: any) {
        const latency = Date.now() - startTime;
        await updateProvider(provider.id, { healthStatus: 'down' });
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
