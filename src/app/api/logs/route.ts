import { NextRequest, NextResponse } from 'next/server';
import { verifyApiKey } from '@/lib/auth';
import { getLogs, getLogsCount, clearLogs } from '@/lib/storage';

export async function GET(request: NextRequest) {
  if (!verifyApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limit = parseInt(request.nextUrl.searchParams.get('limit') || '50');
  const offset = parseInt(request.nextUrl.searchParams.get('offset') || '0');

  const logs = getLogs(Math.min(limit, 200), offset);
  const total = getLogsCount();

  return NextResponse.json({ logs, total });
}

export async function DELETE(request: NextRequest) {
  if (!verifyApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  clearLogs();
  return NextResponse.json({ success: true });
}
