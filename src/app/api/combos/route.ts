import { NextRequest, NextResponse } from 'next/server';
import { verifyDashboardAuth } from '@/lib/auth';
import { getCombos, addCombo, updateCombo, deleteCombo } from '@/lib/storage';
import { withCors, handleCorsPreflight } from '@/lib/cors';

export async function OPTIONS() {
  return handleCorsPreflight();
}

export async function GET(request: NextRequest) {
  if (!await verifyDashboardAuth(request)) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  const combos = await getCombos();
  return withCors(NextResponse.json(combos));
}

export async function POST(request: NextRequest) {
  if (!await verifyDashboardAuth(request)) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  try {
    const body = await request.json();
    const { name, items } = body;

    if (!name || !Array.isArray(items) || items.length === 0) {
      return withCors(
        NextResponse.json(
          { error: 'Name and at least one item are required' },
          { status: 400 }
        )
      );
    }

    const combo = await addCombo(name, items);
    return withCors(NextResponse.json(combo, { status: 201 }));
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
      return withCors(NextResponse.json({ error: 'Missing combo id' }, { status: 400 }));
    }

    const updated = await updateCombo(id, updates);
    if (!updated) {
      return withCors(NextResponse.json({ error: 'Combo not found' }, { status: 404 }));
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

  const deleted = await deleteCombo(id);
  if (!deleted) {
    return withCors(NextResponse.json({ error: 'Combo not found' }, { status: 404 }));
  }

  return withCors(NextResponse.json({ success: true }));
}
