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

  const stats: Stats = {
    totalRequests,
    successCount,
    errorCount,
    successRate: totalRequests > 0 ? Math.round((successCount / totalRequests) * 100) : 0,
    avgLatency,
    providerBreakdown,
  };

  return withCors(NextResponse.json(stats));
}
