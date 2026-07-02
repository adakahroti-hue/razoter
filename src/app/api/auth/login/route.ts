import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser, generateToken, ensureDefaultAdmin } from '@/lib/auth';
import { withCors, handleCorsPreflight } from '@/lib/cors';

export async function OPTIONS() {
  return handleCorsPreflight();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return withCors(
        NextResponse.json(
          { error: 'Username and password are required' },
          { status: 400 }
        )
      );
    }

    // Auto-create admin user if no users exist
    await ensureDefaultAdmin();

    const user = await authenticateUser(username, password);
    if (!user) {
      return withCors(
        NextResponse.json(
          { error: 'Invalid username or password' },
          { status: 401 }
        )
      );
    }

    const token = await generateToken(user.id);

    return withCors(
      NextResponse.json({
        token,
        user: {
          id: user.id,
          username: user.username,
        },
      })
    );
  } catch {
    return withCors(
      NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    );
  }
}
// redeploy
