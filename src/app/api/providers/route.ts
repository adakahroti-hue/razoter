import { NextRequest, NextResponse } from 'next/server';
import { verifyDashboardAuth } from '@/lib/auth';
import { getProviders, addProvider, updateProvider, deleteProvider } from '@/lib/storage';
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
  const masked = providers.map(p => ({
    ...p,
    apiKey: p.apiKey.slice(0, 8) + '...' + p.apiKey.slice(-4),
  }));
  
  return withCors(NextResponse.json(masked));
}

export async function POST(request: NextRequest) {
  if (!await verifyDashboardAuth(request)) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  try {
    const body = await request.json();
    const { name, baseUrl, apiKey, model, priority, enabled } = body;

    if (!name || !baseUrl || !apiKey || !model) {
      return withCors(
        NextResponse.json(
          { error: 'Missing required fields: name, baseUrl, apiKey, model' },
          { status: 400 }
        )
      );
    }

    const provider = await addProvider({
      name,
      baseUrl: baseUrl.replace(/\/$/, ''),
      apiKey,
      model,
      priority: priority ?? 10,
      enabled: enabled ?? true,
    });

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
      updates.baseUrl = updates.baseUrl.replace(/\/$/, '');
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
