import { NextRequest, NextResponse } from 'next/server';
import { verifyDashboardAuth } from '@/lib/auth';
import { getQuotas, addQuota, updateQuota, deleteQuota } from '@/lib/storage';
import { withCors, handleCorsPreflight } from '@/lib/cors';

export async function OPTIONS() {
  return handleCorsPreflight();
}

export async function GET(request: NextRequest) {
  if (!await verifyDashboardAuth(request)) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  const quotas = await getQuotas();
  return withCors(NextResponse.json(quotas));
}

export async function POST(request: NextRequest) {
  if (!await verifyDashboardAuth(request)) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  try {
    const body = await request.json();
    const { providerId, providerName, model, monthlyLimit, resetDay } = body;

    if (!providerId || !providerName) {
      return withCors(NextResponse.json({ error: 'Provider ID and name required' }, { status: 400 }));
    }

    const quota = await addQuota(providerId, providerName, model || '', monthlyLimit || 0, resetDay || 1);
    return withCors(NextResponse.json(quota, { status: 201 }));
  } catch (e: any) {
    return withCors(NextResponse.json({ error: e.message || 'Invalid JSON' }, { status: 400 }));
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
