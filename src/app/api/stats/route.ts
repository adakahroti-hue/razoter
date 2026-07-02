import { NextRequest, NextResponse } from 'next/server';
import { verifyApiKey } from '@/lib/auth';
import { getLogs, getProviders } from '@/lib/storage';
import { Stats } from '@/lib/types';

export async function GET(request: NextRequest) {
  if (!verifyApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const logs = getLogs(500);
  const providers = getProviders();

  const successCount = logs.filter(l => l.status === 'success').length;
  const errorCount = logs.filter(l => l.status === 'error' || l.status === 'timeout').length;
  const totalRequests = logs.length;
  const avgLatency = totalRequests > 0
    ? Math.round(logs.reduce((sum, l) => sum + l.latencyMs, 0) / totalRequests)
    : 0;

  const providerBreakdown = providers.map(p => {
    const pLogs = logs.filter(l => l.providerId === p.id);
    const pSuccesses = pLogs.filter(l => l.status === 'success').length;
    return {
      providerId: p.id,
      providerName: p.name,
      requests: pLogs.length,
      successes: pSuccesses,
      errors: pLogs.length - pSuccesses,
      avgLatency: pLogs.length > 0
        ? Math.round(pLogs.reduce((sum, l) => sum + l.latencyMs, 0) / pLogs.length)
        : 0,
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

  return NextResponse.json(stats);
}
