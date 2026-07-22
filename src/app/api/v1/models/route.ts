import { NextRequest, NextResponse } from 'next/server';
import { verifyApiKey } from '@/lib/auth';
import { getEnabledProviders, getCombos } from '@/lib/storage';
import { withCors, handleCorsPreflight } from '@/lib/cors';

export async function OPTIONS() {
  return handleCorsPreflight();
}

/**
 * GET /api/v1/models
 * OpenAI-compatible models list.
 * Includes:
 *  - selected/available models from enabled providers
 *  - enabled Gabung (combo) names so clients can "pull" and use them
 */
export async function GET(request: NextRequest) {
  if (!await verifyApiKey(request)) {
    return withCors(
      NextResponse.json(
        { error: { message: 'Invalid API key', type: 'auth_error', code: 'invalid_api_key' } },
        { status: 401 }
      )
    );
  }

  try {
    const [providers, combos] = await Promise.all([
      getEnabledProviders(),
      getCombos(),
    ]);

    const seen = new Set<string>();
    const data: Array<{
      id: string;
      object: 'model';
      created: number;
      owned_by: string;
    }> = [];

    // Provider models first (selectedModels preferred)
    for (const p of providers) {
      const models = (p.selectedModels?.length ? p.selectedModels : p.models) || [];
      const created = p.createdAt ? Math.floor(new Date(p.createdAt).getTime() / 1000) : Math.floor(Date.now() / 1000);
      for (const m of models) {
        if (!m || seen.has(m)) continue;
        seen.add(m);
        data.push({
          id: m,
          object: 'model',
          created,
          owned_by: p.name || 'provider',
        });
      }
    }

    // Gabung / combo models — these are the virtual names clients should use
    for (const c of combos) {
      if (!c.enabled) continue;
      if (!c.name || seen.has(c.name)) continue;
      seen.add(c.name);
      data.push({
        id: c.name,
        object: 'model',
        created: c.createdAt ? Math.floor(new Date(c.createdAt).getTime() / 1000) : Math.floor(Date.now() / 1000),
        owned_by: 'razoter-combo',
      });
    }

    return withCors(
      NextResponse.json({
        object: 'list',
        data,
      })
    );
  } catch (e: any) {
    return withCors(
      NextResponse.json(
        { error: { message: e?.message || 'Failed to list models', type: 'server_error' } },
        { status: 500 }
      )
    );
  }
}
