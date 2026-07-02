import { Provider, AppConfig, RequestLog, RateLimitEntry } from './types';
import { randomUUID } from 'crypto';

// In-memory storage for Vercel serverless (resets on cold start)
// For production, use Vercel KV, Postgres, or a database

let providers: Provider[] = [];
let logs: RequestLog[] = [];
let config: AppConfig = {
  mode: 'failover',
  razoterApiKey: process.env.RAZOTER_API_KEY || 'razoter-default-key-change-me',
  maxRetries: 3,
  timeoutMs: 30000,
};
let roundRobinIndex = 0;

// Rate limiting per IP
const rateLimitStore = new Map<string, RateLimitEntry>();

const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '60'); // requests per window
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'); // 1 minute

// ─── Rate Limiting ───────────────────────────────────────

export function checkRateLimit(ip: string): { allowed: boolean; limit: number; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);

  if (!entry || now > entry.resetAt) {
    // New window
    const resetAt = now + RATE_LIMIT_WINDOW_MS;
    rateLimitStore.set(ip, { count: 1, resetAt });
    return { allowed: true, limit: RATE_LIMIT_MAX, remaining: RATE_LIMIT_MAX - 1, resetAt };
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return { allowed: false, limit: RATE_LIMIT_MAX, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return { allowed: true, limit: RATE_LIMIT_MAX, remaining: RATE_LIMIT_MAX - entry.count, resetAt: entry.resetAt };
}

// ─── Providers ────────────────────────────────────────────

export function getProviders(): Provider[] {
  return providers;
}

export function getProvider(id: string): Provider | undefined {
  return providers.find(p => p.id === id);
}

export function addProvider(data: Omit<Provider, 'id' | 'createdAt' | 'requestCount' | 'errorCount' | 'avgLatency' | 'healthStatus'>): Provider {
  const provider: Provider = {
    ...data,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    requestCount: 0,
    errorCount: 0,
    avgLatency: 0,
    healthStatus: 'unknown',
  };
  providers.push(provider);
  return provider;
}

export function updateProvider(id: string, data: Partial<Provider>): Provider | null {
  const idx = providers.findIndex(p => p.id === id);
  if (idx === -1) return null;
  providers[idx] = { ...providers[idx], ...data, id };
  return providers[idx];
}

export function deleteProvider(id: string): boolean {
  const idx = providers.findIndex(p => p.id === id);
  if (idx === -1) return false;
  providers.splice(idx, 1);
  return true;
}

export function getEnabledProviders(): Provider[] {
  return providers.filter(p => p.enabled);
}

export function updateProviderStats(providerId: string, success: boolean, latencyMs: number) {
  const provider = providers.find(p => p.id === providerId);
  if (!provider) return;
  
  provider.requestCount++;
  provider.lastUsed = new Date().toISOString();
  
  if (!success) {
    provider.errorCount++;
  }
  
  // Rolling average latency
  provider.avgLatency = Math.round(
    (provider.avgLatency * (provider.requestCount - 1) + latencyMs) / provider.requestCount
  );
  
  // Health status based on error rate
  const errorRate = provider.errorCount / provider.requestCount;
  if (errorRate < 0.1) provider.healthStatus = 'healthy';
  else if (errorRate < 0.3) provider.healthStatus = 'degraded';
  else provider.healthStatus = 'down';
}

export function updateProviderRateLimit(
  providerId: string,
  remaining: number | undefined,
  reset: number | undefined,
  total: number | undefined
) {
  const provider = providers.find(p => p.id === providerId);
  if (!provider) return;
  if (remaining !== undefined) provider.rateLimitRemaining = remaining;
  if (reset !== undefined) provider.rateLimitReset = reset;
  if (total !== undefined) provider.rateLimitTotal = total;
}

// ─── Config ───────────────────────────────────────────────

export function getConfig(): AppConfig {
  return config;
}

export function updateConfig(data: Partial<AppConfig>): AppConfig {
  config = { ...config, ...data };
  return config;
}

export function getRoundRobinIndex(): number {
  return roundRobinIndex;
}

export function incrementRoundRobinIndex(max: number): number {
  roundRobinIndex = (roundRobinIndex + 1) % max;
  return roundRobinIndex;
}

// ─── Logs ─────────────────────────────────────────────────

export function addLog(log: Omit<RequestLog, 'id' | 'timestamp'>): RequestLog {
  const entry: RequestLog = {
    ...log,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
  };
  logs.unshift(entry);
  // Keep only last 500 logs in memory
  if (logs.length > 500) logs = logs.slice(0, 500);
  return entry;
}

export function getLogs(limit = 50, offset = 0): RequestLog[] {
  return logs.slice(offset, offset + limit);
}

export function clearLogs() {
  logs = [];
}

export function getLogsCount(): number {
  return logs.length;
}
