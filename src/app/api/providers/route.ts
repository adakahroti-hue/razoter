import { NextRequest, NextResponse } from 'next/server';
import { verifyDashboardAuth } from '@/lib/auth';
import { getProviders, getProvider, addProvider, updateProvider, deleteProvider, addQuota } from '@/lib/storage';
import { withCors, handleCorsPreflight } from '@/lib/cors';

export async function OPTIONS() {
  return handleCorsPreflight();
}

export async function GET(request: NextRequest) {
  if (!await verifyDashboardAuth(request)) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  const providers = await getProviders();
  // Mask API keys in response
  const maskKey = (k?: string) =>
    k && k.length >= 12 ? `${k.slice(0, 8)}...${k.slice(-4)}` : (k ? `${k.slice(0, 2)}...` : '');

  const masked = providers.map(p => ({
    ...p,
    apiKey: maskKey(p.apiKey),
    apiKeys: (p.apiKeys || []).map((ak: any) => ({
      ...ak,
      key: maskKey(ak.key),
    })),
  }));
  
  return withCors(NextResponse.json(masked));
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

    if (updates.baseUrl) {
      updates.baseUrl = updates.baseUrl.replace(/\/+$/, '');
    }

    // Handle apiKey (single) - skip if masked
    if (updates.apiKey && updates.apiKey.includes('...')) {
      delete updates.apiKey;
    }

    // Handle apiKeys (multi) - merge new keys with existing ones
    if (updates.apiKeys && Array.isArray(updates.apiKeys)) {
      const newKeys = updates.apiKeys.filter((k: any) => k && k.key && !k.key.includes('...'));
      if (newKeys.length > 0) {
        // Fetch existing provider to merge keys
        const existing = await getProvider(id);
        if (existing && existing.apiKeys && existing.apiKeys.length > 0) {
          // Merge: keep existing keys, add new ones (avoid duplicates by name)
          const existingNames = new Set(existing.apiKeys.map((k: any) => k.name));
          const merged = [...existing.apiKeys];
          for (const nk of newKeys) {
            if (!existingNames.has(nk.name)) {
              merged.push({ name: nk.name, key: nk.key, enabled: nk.enabled ?? true });
            } else {
              // Update existing key with same name
              const idx = merged.findIndex((k: any) => k.name === nk.name);
              if (idx >= 0) merged[idx] = { name: nk.name, key: nk.key, enabled: nk.enabled ?? true };
            }
          }
          updates.apiKeys = merged;
        }
        // If no existing keys, just use the new keys as-is
      } else {
        // All keys are masked = user didn't change any key. Don't overwrite.
        delete updates.apiKeys;
      }
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

  const deleted = await deleteProvider(id);
  if (!deleted) {
    return withCors(NextResponse.json({ error: 'Provider not found' }, { status: 404 }));
  }

  return withCors(NextResponse.json({ success: true }));
}
