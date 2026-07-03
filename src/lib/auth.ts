import { NextRequest } from 'next/server';
import { getConfig } from './storage';
import { supabase } from './supabase';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'razoter-jwt-secret-change-me-in-production'
);

// ─── Password hashing ─────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ─── JWT token management ─────────────────────────────

export async function generateToken(userId: string): Promise<string> {
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return { userId: payload.userId as string };
  } catch {
    return null;
  }
}

// ─── User management ──────────────────────────────────

export async function createUser(username: string, password: string): Promise<{ id: string; username: string } | null> {
  const passwordHash = await hashPassword(password);

  const { data, error } = await supabase
    .from('users')
    .insert({ username, password_hash: passwordHash })
    .select('id, username')
    .single();

  if (error) {
    console.error('Supabase createUser error:', error);
    return null;
  }

  return data;
}

export async function authenticateUser(username: string, password: string): Promise<{ id: string; username: string } | null> {
  const { data, error } = await supabase
    .from('users')
    .select('id, username, password_hash')
    .eq('username', username)
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const valid = await verifyPassword(password, data.password_hash);
  if (!valid) {
    return null;
  }

  // Update last_login
  await supabase
    .from('users')
    .update({ last_login: new Date().toISOString() })
    .eq('id', data.id);

  return { id: data.id, username: data.username };
}

export async function getUsers(): Promise<{ id: string; username: string; created_at: string; last_login: string | null }[]> {
  const { data, error } = await supabase
    .from('users')
    .select('id, username, created_at, last_login')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Supabase getUsers error:', error);
    return [];
  }

  return data ?? [];
}

export async function getUserById(id: string): Promise<{ id: string; username: string } | null> {
  const { data, error } = await supabase
    .from('users')
    .select('id, username')
    .eq('id', id)
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data;
}

// ─── API Key auth (kept for proxy endpoint) ───────────

export async function verifyApiKey(request: NextRequest): Promise<boolean> {
  const authHeader = request.headers.get('authorization');

  if (!authHeader) {
    console.error('[verifyApiKey] No authorization header');
    return false;
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  console.error('[verifyApiKey] Token prefix:', token.slice(0, 10), 'length:', token.length);

  // Check against the main config key first
  try {
    const config = await getConfig();
    console.error('[verifyApiKey] Config key prefix:', config.razoterApiKey?.slice(0, 10), 'length:', config.razoterApiKey?.length);
    console.error('[verifyApiKey] Config match:', token === config.razoterApiKey);
    if (token === config.razoterApiKey) return true;
  } catch (e: unknown) {
    console.error('[verifyApiKey] getConfig error:', (e as Error).message);
  }

  // Check against api_keys table
  try {
    const { data, error } = await supabase
      .from('api_keys')
      .select('id')
      .eq('key', token)
      .limit(1)
      .maybeSingle();
    console.error('[verifyApiKey] api_keys lookup:', data ? 'FOUND' : 'NOT FOUND', error?.message || '');
    if (data) return true;
  } catch (e: unknown) {
    console.error('[verifyApiKey] api_keys query error:', (e as Error).message);
  }

  console.error('[verifyApiKey] All checks failed, returning false');
  return false;
}

export function getApiKeyFromRequest(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return null;
  return authHeader.replace(/^Bearer\s+/i, '').trim();
}

// ─── JWT auth for dashboard API routes ────────────────

export async function verifyJwtAuth(request: NextRequest): Promise<{ userId: string; username: string } | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return null;

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const payload = await verifyToken(token);
  if (!payload) return null;

  const user = await getUserById(payload.userId);
  if (!user) return null;

  return { userId: user.id, username: user.username };
}

// ─── Unified auth: accepts either JWT or API key ──────
// This is used by dashboard API routes so the proxy
// endpoint can keep using API keys while the dashboard
// uses JWT tokens.

export async function verifyDashboardAuth(request: NextRequest): Promise<boolean> {
  // Try JWT first
  const jwtResult = await verifyJwtAuth(request);
  if (jwtResult) return true;

  // Fall back to API key
  return verifyApiKey(request);
}

// ─── Default admin creation ───────────────────────────

export async function ensureDefaultAdmin(): Promise<void> {
  const { data, error } = await supabase
    .from('users')
    .select('id')
    .eq('username', 'admin')
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Error checking for admin user:', error);
    return;
  }

  if (!data) {
    console.log('Creating default admin user...');
    const result = await createUser('admin', 'admin123');
    if (result) {
      console.log('Default admin user created. Username: admin, Password: admin123');
      console.log('⚠️  Please change the default password after first login!');
    } else {
      console.log('Could not create default admin user (table may not exist yet).');
    }
  }
}
