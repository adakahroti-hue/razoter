import { NextRequest, NextResponse } from 'next/server';
import { verifyDashboardAuth } from '@/lib/auth';
import {
  getQuotas,
  addQuota,
  updateQuota,
  deleteQuota,
  ensureQuotaRow,
  getLifetimeTokenByApiKey,
} from '@/lib/storage';
import { withCors, handleCorsPreflight } from '@/lib/cors';

export async function OPTIONS() {
  return handleCorsPreflight();
}

export async function GET(request: NextRequest) {
  if (!await verifyDashboardAuth(request)) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  const includeLifetime = request.nextUrl.searchParams.get('lifetime') === '1';
  const quotas = await getQuotas();
  if (!includeLifetime) {
    return withCors(NextResponse.json(quotas));
  }

  const lifetimeTokenByApiKey = await getLifetimeTokenByApiKey();
  return withCors(NextResponse.json({ quotas, lifetimeTokenByApiKey }));
}

export async function POST(request: NextRequest) {
  if (!await verifyDashboardAuth(request)) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  try {
    const body = await request.json();
    const { providerId, providerName, model, monthlyLimit, resetDay, apiKeyName, ensure } = body;

    if (!providerId || !providerName) {
      return withCors(NextResponse.json({ error: 'Provider ID and name required' }, { status: 400 }));
    }

    // ensure=true → create only if missing (idempotent auto-sync / limit UI)
    if (ensure) {
      const quota = await ensureQuotaRow(
        providerId,
        providerName,
        apiKeyName || '',
        model || '',
        monthlyLimit || 0,
        resetDay || 1
      );
      return withCors(NextResponse.json(quota, { status: 200 }));
    }

    const quota = await addQuota(
      providerId,
      providerName,
      model || '',
      monthlyLimit || 0,
      resetDay || 1,
      apiKeyName || ''
    );
    return withCors(NextResponse.json(quota, { status: 201 }));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Invalid JSON';
    return withCors(NextResponse.json({ error: msg }, { status: 400 }));
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
      return withCors(NextResponse.json({ error: 'Missing quota id' }, { status: 400 }));
    }

    // Support upsert-style save from limit UI:
    // if id is temporary/missing row, create via ensure then update limit.
    if (typeof id === 'string' && id.startsWith('new:')) {
      // format new:{providerId}|{apiKeyName}|{model}
      const raw = id.slice(4);
      const [providerId, apiKeyName = '', model = ''] = raw.split('|');
      if (!providerId || !updates.providerName) {
        return withCors(NextResponse.json({ error: 'Missing provider for new quota' }, { status: 400 }));
      }
      const created = await ensureQuotaRow(
        providerId,
        String(updates.providerName),
        apiKeyName,
        model,
        Number(updates.monthlyLimit ?? 0),
        Number(updates.resetDay ?? 1)
      );
      const updated = await updateQuota(created.id, {
        monthlyLimit: updates.monthlyLimit,
        resetDay: updates.resetDay,
      });
      return withCors(NextResponse.json(updated || created));
    }

    const updated = await updateQuota(id, updates);
    if (!updated) {
      return withCors(NextResponse.json({ error: 'Quota not found' }, { status: 404 }));
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
    return withCors(NextResponse.json({ error: 'Missing id' }, { status: 400 }));
  }

  const deleted = await deleteQuota(id);
  if (!deleted) {
    return withCors(NextResponse.json({ error: 'Quota not found' }, { status: 404 }));
  }

  return withCors(NextResponse.json({ success: true }));
}
