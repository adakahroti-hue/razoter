import { NextRequest, NextResponse } from 'next/server';
import { verifyDashboardAuth } from '@/lib/auth';
import { getLogs, getLogsCount, clearLogs, resetLogsAndUsageCounters } from '@/lib/storage';
import { withCors, handleCorsPreflight } from '@/lib/cors';

export async function OPTIONS() {
  return handleCorsPreflight();
}

export async function GET(request: NextRequest) {
  if (!await verifyDashboardAuth(request)) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  const limit = parseInt(request.nextUrl.searchParams.get('limit') || '50');
  const offset = parseInt(request.nextUrl.searchParams.get('offset') || '0');

  const [logs, total] = await Promise.all([
    getLogs(limit, offset),
    getLogsCount(),
  ]);

  return withCors(NextResponse.json({ logs, total, limit, offset }));
}

/**
 * DELETE /api/logs
 * Full Logs-tab reset (default):
 * - clear request logs
 * - zero quota usage counters
 * - wipe lifetime token totals (if table exists)
 *
 * Optional: ?logsOnly=1  → only clear request_logs (legacy)
 */
export async function DELETE(request: NextRequest) {
  if (!await verifyDashboardAuth(request)) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  const logsOnly = request.nextUrl.searchParams.get('logsOnly') === '1';
  if (logsOnly) {
    await clearLogs();
    return withCors(NextResponse.json({ success: true, mode: 'logsOnly' }));
  }

  const result = await resetLogsAndUsageCounters();
  return withCors(NextResponse.json({ success: true, mode: 'full', ...result }));
}
