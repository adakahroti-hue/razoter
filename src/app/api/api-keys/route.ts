import { NextRequest, NextResponse } from 'next/server';
import { verifyDashboardAuth } from '@/lib/auth';
import { getApiKeys, addApiKey, deleteApiKey } from '@/lib/storage';
import { withCors, handleCorsPreflight } from '@/lib/cors';

export async function OPTIONS() {
  return handleCorsPreflight();
}

export async function GET(request: NextRequest) {
  if (!await verifyDashboardAuth(request)) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  const keys = await getApiKeys();
  return withCors(NextResponse.json(keys));
}

export async function POST(request: NextRequest) {
  if (!await verifyDashboardAuth(request)) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  try {
    const body = await request.json();
    const { name } = body;

    if (!name) {
      return withCors(NextResponse.json({ error: 'Name is required' }, { status: 400 }));
    }

    // Generate a random API key
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let key = 'rz-';
    for (let i = 0; i < 32; i++) {
      key += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    const apiKey = await addApiKey(name, key);
    return withCors(NextResponse.json(apiKey, { status: 201 }));
  } catch (e: any) {
    return withCors(NextResponse.json({ error: e.message || 'Invalid JSON' }, { status: 400 }));
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

  const deleted = await deleteApiKey(id);
  if (!deleted) {
    return withCors(NextResponse.json({ error: 'Key not found' }, { status: 404 }));
  }

  return withCors(NextResponse.json({ success: true }));
}
