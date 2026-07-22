import { NextRequest, NextResponse } from 'next/server';
import { verifyDashboardAuth } from '@/lib/auth';
import { getProviders, getProvider, addProvider, updateProvider, deleteProvider, addQuota, archiveProvider } from '@/lib/storage';
import { withCors, handleCorsPreflight } from '@/lib/cors';

export async function OPTIONS() {
  return handleCorsPreflight();
}

export async function GET(request: NextRequest) {
  if (!await verifyDashboardAuth(request)) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  // ?archived=true  → only archived (Arsip tab)
  // ?archived=all   → everything
  // default         → active only (Providers tab)
  const archivedParam = request.nextUrl.searchParams.get('archived');
  const mode = archivedParam === 'true' ? 'archived' : archivedParam === 'all' ? 'all' : 'active';
  const providers = await getProviders(mode);
  return withCors(NextResponse.json(providers));
}

export async function POST(request: NextRequest) {
  if (!await verifyDashboardAuth(request)) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  try {
    const body = await request.json();
    const { name, baseUrl, apiKey, models, selectedModels, priority, enabled, apiKeys, apiKeyStrategy } = body;

    if (!name || !baseUrl || !apiKey) {
      return withCors(
        NextResponse.json(
          { error: 'Missing required fields: name, baseUrl, apiKey' },
          { status: 400 }
        )
      );
    }

    // models is required and must be a non-empty array
    if (!Array.isArray(models) || models.length === 0) {
      return withCors(
        NextResponse.json(
          { error: 'At least one model is required. Click "Test Connection" to discover models.' },
          { status: 400 }
        )
      );
    }

    const selected = Array.isArray(selectedModels) && selectedModels.length > 0
      ? selectedModels
      : models; // default: all models selected

    const provider = await addProvider({ ...apiKeys ? { apiKeys } : {}, ...apiKeyStrategy ? { apiKeyStrategy } : {},
      name,
      baseUrl: baseUrl.replace(/\/+$/, ''),
      apiKey,
      models,
      selectedModels: selected,
      priority: priority ?? 10,
      enabled: enabled ?? true,
    });

    // Auto-create quota entry for each API key (not per model)
    const apiKeysList = apiKeys && Array.isArray(apiKeys) && apiKeys.length > 0
      ? apiKeys
      : [{ name: 'Default', key: provider.apiKey, enabled: true }];
    for (const ak of apiKeysList) {
      try {
        await addQuota(provider.id, name, '', 0, 1, ak.name);
      } catch {}
    }

    return withCors(NextResponse.json(provider, { status: 201 }));
  } catch {
    return withCors(NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }));
  }
}

export async function PUT(request: NextRequest) {
  if (!await verifyDashboardAuth(request)) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return withCors(NextResponse.json({ error: 'Missing provider id' }, { status: 400 }));
    }

    // Dedicated archive/restore path (also accepted via DELETE ?action=archive)
    if (typeof updates.archived === 'boolean' && Object.keys(updates).length === 1) {
      const ok = await archiveProvider(id, updates.archived);
      if (!ok) {
        return withCors(NextResponse.json({ error: 'Provider not found' }, { status: 404 }));
      }
      const provider = await getProvider(id);
      return withCors(NextResponse.json(provider ?? { success: true, archived: updates.archived }));
    }

    if (updates.baseUrl) {
      updates.baseUrl = updates.baseUrl.replace(/\/+$/, '');
    }

    // Handle apiKey (single) - skip if masked
    if (updates.apiKey && updates.apiKey.includes('...')) {
      delete updates.apiKey;
    }

    // Handle apiKeys (multi) — client array is authoritative for ORDER + NAMES + enabled.
    // Fill in values for any key left empty/masked by matching existing name.
    if (updates.apiKeys && Array.isArray(updates.apiKeys)) {
      const clientKeys = updates.apiKeys as Array<{ name?: string; key?: string; enabled?: boolean }>;
      const existing = await getProvider(id);
      const existingMap = new Map<string, any>();
      if (existing?.apiKeys) for (const k of existing.apiKeys) existingMap.set(k.name, k);

      const result: Array<{ name: string; key: string; enabled: boolean }> = [];
      for (const ck of clientKeys) {
        if (!ck || !ck.name) continue;
        if (ck.key && !ck.key.includes('...')) {
          // New/changed secret provided
          result.push({ name: ck.name, key: ck.key, enabled: ck.enabled ?? true });
        } else {
          // empty/masked → keep existing secret matched by name, but honor enabled toggle
          const ex = existingMap.get(ck.name);
          if (ex) {
            result.push({
              name: ck.name,
              key: ex.key,
              enabled: ck.enabled ?? ex.enabled ?? true,
            });
          } else if (ck.key && !ck.key.includes('...')) {
            result.push({ name: ck.name, key: ck.key, enabled: ck.enabled ?? true });
          }
          // brand-new key with empty secret is skipped
        }
      }
      // Allow enabled-only updates even when no raw secrets were retyped.
      updates.apiKeys = result.length > 0 ? result : existing?.apiKeys ?? [];
    }

    const updated = await updateProvider(id, updates);
    if (!updated) {
      return withCors(NextResponse.json({ error: 'Provider not found' }, { status: 404 }));
    }

    return withCors(NextResponse.json(updated));
  } catch {
    return withCors(NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }));
  }
}

export async function DELETE(request: NextRequest) {
  if (!await verifyDashboardAuth(request)) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  const id = request.nextUrl.searchParams.get('id');
  if (!id) {
    return withCors(NextResponse.json({ error: 'Missing provider id' }, { status: 400 }));
  }

  // Archive / unarchive action (soft hide) — keeps data, just hides from active list
  const action = request.nextUrl.searchParams.get('action');
  if (action === 'archive') {
    const archived = request.nextUrl.searchParams.get('archived') !== 'false';
    const ok = await archiveProvider(id, archived);
    if (!ok) {
      return withCors(NextResponse.json({ error: 'Provider not found' }, { status: 404 }));
    }
    return withCors(NextResponse.json({ success: true, archived }));
  }

  const deleted = await deleteProvider(id);
  if (!deleted) {
    return withCors(NextResponse.json({ error: 'Provider not found' }, { status: 404 }));
  }

  return withCors(NextResponse.json({ success: true }));
}
