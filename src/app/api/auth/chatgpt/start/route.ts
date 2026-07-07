import { NextRequest, NextResponse } from 'next/server';
import { verifyDashboardAuth } from '@/lib/auth';
import { withCors, handleCorsPreflight } from '@/lib/cors';
import { requestDeviceCode } from '@/lib/chatgpt-auth';

export async function OPTIONS() {
  return handleCorsPreflight();
}

/**
 * POST /api/auth/chatgpt/start
 * Start the ChatGPT Plus device code login flow.
 * Returns { device_auth_id, user_code, interval, expires_at }
 * The user must then visit auth.openai.com/codex/device and enter the code.
 */
export async function POST(request: NextRequest) {
  if (!await verifyDashboardAuth(request)) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  try {
    const result = await requestDeviceCode();
    return withCors(NextResponse.json({
      device_auth_id: result.device_auth_id,
      user_code: result.user_code,
      interval: result.interval,
      expires_at: result.expires_at,
      verification_url: 'https://auth.openai.com/codex/device',
    }));
  } catch (err: any) {
    return withCors(
      NextResponse.json({ error: err.message }, { status: 500 })
    );
  }
}
