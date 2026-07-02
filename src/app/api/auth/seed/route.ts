import { NextResponse } from 'next/server';
import { ensureDefaultAdmin } from '@/lib/auth';
import { withCors, handleCorsPreflight } from '@/lib/cors';

export async function OPTIONS() {
  return handleCorsPreflight();
}

export async function POST() {
  try {
    await ensureDefaultAdmin();
    return withCors(
      NextResponse.json({ 
        message: 'Default admin user ensured',
        credentials: {
          username: 'admin',
          password: 'admin123'
        }
      })
    );
  } catch (error) {
    return withCors(
      NextResponse.json({ error: 'Failed to create admin user' }, { status: 500 })
    );
  }
}
