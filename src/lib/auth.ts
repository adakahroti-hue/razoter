import { NextRequest } from 'next/server';
import { getConfig } from './storage';

export async function verifyApiKey(request: NextRequest): Promise<boolean> {
  const config = await getConfig();
  const authHeader = request.headers.get('authorization');
  
  if (!authHeader) return false;
  
  // Support both "Bearer sk-xxx" and direct key
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  return token === config.razoterApiKey;
}

export function getApiKeyFromRequest(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return null;
  return authHeader.replace(/^Bearer\s+/i, '').trim();
}
