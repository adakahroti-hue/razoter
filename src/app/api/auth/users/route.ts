import { NextRequest, NextResponse } from 'next/server';
import { createUser, getUsers, verifyJwtAuth } from '@/lib/auth';
import { withCors, handleCorsPreflight } from '@/lib/cors';

export async function OPTIONS() {
  return handleCorsPreflight();
}

// GET /api/auth/users - List all users (admin only)
export async function GET(request: NextRequest) {
  const auth = await verifyJwtAuth(request);
  if (!auth) {
    return withCors(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    );
  }

  const users = await getUsers();
  return withCors(NextResponse.json(users));
}

// POST /api/auth/users - Create a new user (admin only)
export async function POST(request: NextRequest) {
  const auth = await verifyJwtAuth(request);
  if (!auth) {
    return withCors(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    );
  }

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

    if (password.length < 6) {
      return withCors(
        NextResponse.json(
          { error: 'Password must be at least 6 characters' },
          { status: 400 }
        )
      );
    }

    const user = await createUser(username, password);
    if (!user) {
      return withCors(
        NextResponse.json(
          { error: 'Failed to create user. Username may already exist.' },
          { status: 409 }
        )
      );
    }

    return withCors(NextResponse.json(user, { status: 201 }));
  } catch {
    return withCors(
      NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    );
  }
}
