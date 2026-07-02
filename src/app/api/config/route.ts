import { NextRequest, NextResponse } from 'next/server';
import { verifyApiKey } from '@/lib/auth';
import { getConfig, updateConfig } from '@/lib/storage';

export async function GET(request: NextRequest) {
  if (!verifyApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const config = getConfig();
  return NextResponse.json({
    mode: config.mode,
    maxRetries: config.maxRetries,
    timeoutMs: config.timeoutMs,
  });
}

export async function PUT(request: NextRequest) {
  if (!verifyApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { mode, maxRetries, timeoutMs } = body;

    if (mode && !['failover', 'round-robin', 'priority'].includes(mode)) {
      return NextResponse.json({ error: 'Invalid mode. Must be: failover, round-robin, priority' }, { status: 400 });
    }

    const updates: any = {};
    if (mode) updates.mode = mode;
    if (maxRetries !== undefined) updates.maxRetries = Math.max(1, Math.min(10, maxRetries));
    if (timeoutMs !== undefined) updates.timeoutMs = Math.max(5000, Math.min(120000, timeoutMs));

    const config = updateConfig(updates);
    return NextResponse.json({
      mode: config.mode,
      maxRetries: config.maxRetries,
      timeoutMs: config.timeoutMs,
    });
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
}
