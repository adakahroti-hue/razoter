import { NextRequest, NextResponse } from 'next/server';
import { verifyApiKey } from '@/lib/auth';
import { getConfig, updateConfig } from '@/lib/storage';
import { withCors, handleCorsPreflight } from '@/lib/cors';

export async function OPTIONS() {
  return handleCorsPreflight();
}

export async function GET(request: NextRequest) {
  if (!await verifyApiKey(request)) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  const config = await getConfig();
  return withCors(
    NextResponse.json({
      mode: config.mode,
      maxRetries: config.maxRetries,
      timeoutMs: config.timeoutMs,
      apiKeyMasked: config.razoterApiKey.slice(0, 6) + '***' + config.razoterApiKey.slice(-4),
    })
  );
}

export async function PUT(request: NextRequest) {
  if (!await verifyApiKey(request)) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  try {
    const body = await request.json();
    const { mode, maxRetries, timeoutMs, action, currentKey, newKey } = body;

    // Handle API key change
    if (action === 'change_key') {
      if (!currentKey || !newKey) {
        return withCors(
          NextResponse.json({ error: 'Both currentKey and newKey are required' }, { status: 400 })
        );
      }
      const config = await getConfig();
      if (currentKey !== config.razoterApiKey) {
        return withCors(
          NextResponse.json({ error: 'Current key is incorrect' }, { status: 403 })
        );
      }
      if (newKey.length < 8) {
        return withCors(
          NextResponse.json({ error: 'New key must be at least 8 characters' }, { status: 400 })
        );
      }
      await updateConfig({ razoterApiKey: newKey });
      return withCors(
        NextResponse.json({
          success: true,
          message: 'API key updated successfully',
          apiKeyMasked: newKey.slice(0, 6) + '***' + newKey.slice(-4),
        })
      );
    }

    // Handle API key regeneration
    if (action === 'regenerate_key') {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      let newApiKey = 'razoter-';
      for (let i = 0; i < 32; i++) {
        newApiKey += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      await updateConfig({ razoterApiKey: newApiKey });
      return withCors(
        NextResponse.json({
          success: true,
          message: 'API key regenerated successfully',
          apiKey: newApiKey,
          apiKeyMasked: newApiKey.slice(0, 6) + '***' + newApiKey.slice(-4),
        })
      );
    }

    // Normal config update
    if (mode && !['failover', 'round-robin', 'priority'].includes(mode)) {
      return withCors(
        NextResponse.json({ error: 'Invalid mode. Must be: failover, round-robin, priority' }, { status: 400 })
      );
    }

    const updates: any = {};
    if (mode) updates.mode = mode;
    if (maxRetries !== undefined) updates.maxRetries = Math.max(1, Math.min(10, maxRetries));
    if (timeoutMs !== undefined) updates.timeoutMs = Math.max(5000, Math.min(120000, timeoutMs));

    const config = await updateConfig(updates);
    return withCors(
      NextResponse.json({
        mode: config.mode,
        maxRetries: config.maxRetries,
        timeoutMs: config.timeoutMs,
        apiKeyMasked: config.razoterApiKey.slice(0, 6) + '***' + config.razoterApiKey.slice(-4),
      })
    );
  } catch {
    return withCors(NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }));
  }
}
