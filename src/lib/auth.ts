import { NextRequest } from 'next/server';
import { getConfig } from './storage';
import { supabase } from './supabase';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';

let _jwtSecret: Uint8Array | null = null;
function getJwtSecret(): Uint8Array {
  if (_jwtSecret) return _jwtSecret;
  const raw = process.env.JWT_SECRET;
  if (!raw) {
    throw new Error('FATAL: JWT_SECRET environment variable is not set. Refusing to start with a hardcoded secret.');
  }
  _jwtSecret = new TextEncoder().encode(raw);
  return _jwtSecret;
}

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
    .sign(getJwtSecret());
}

export async function verifyToken(token: string): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
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
import { timingSafeEqual } from 'crypto';

// Cache config key + api key existence to avoid 2 DB hits per proxy request
let cachedRazoterKey: string | null = null;
let cachedApiKeys = new Set<string>();
let cacheExpiry = 0;
const CACHE_TTL = 30_000; // 30s

async function refreshKeyCache(): Promise<void> {
  if (Date.now() < cacheExpiry) return;
  try {
    const config = await getConfig();
    cachedRazoterKey = config.razoterApiKey;
    const { data } = await supabase
      .from('api_keys')
      .select('key');
    cachedApiKeys = new Set((data || []).map((k: any) => k.key).filter(Boolean));
    cacheExpiry = Date.now() + CACHE_TTL;
  } catch {
    // keep stale cache on error
  }
}

export async function verifyApiKey(request: NextRequest): Promise<boolean> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return false;

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;

  await refreshKeyCache();

  // Constant-time comparison against cached keys
  const candidates = cachedRazoterKey ? [cachedRazoterKey, ...cachedApiKeys] : [...cachedApiKeys];
  for (const key of candidates) {
    if (key.length === token.length && timingSafeEqual(Buffer.from(key), Buffer.from(token))) {
      return true;
    }
  }
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
      console.log('Default admin user created. Username: admin. CHANGE THE PASSWORD AFTER FIRST LOGIN.');
    } else {
      console.log('Could not create default admin user (table may not exist yet).');
    }
  }
}
