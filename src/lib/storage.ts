import { Provider, AppConfig, RequestLog, RateLimitEntry, ApiKey, Combo, Quota } from './types';
import { supabase } from './supabase';
import { randomUUID } from 'crypto';

// In-memory round-robin index (not persisted)
let roundRobinIndex = 0;

// Rate limiting per IP (in-memory, resets on cold start - acceptable for serverless)
const rateLimitStore = new Map<string, RateLimitEntry>();

const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '60');
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000');

// ─── Mapping helpers (camelCase ↔ snake_case) ────────────

function dbToProvider(row: any): Provider {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    apiKey: row.api_key ?? '',
    authType: row.auth_type ?? 'api_key',
    chatgptRefreshToken: row.chatgpt_refresh_token ?? undefined,
    chatgptExpiresAt: row.chatgpt_expires_at ?? undefined,
    models: row.models ?? (row.model ? [row.model] : []),
    selectedModels: row.selected_models ?? (row.model ? [row.model] : []),
    apiKeys: Array.isArray(row.api_keys) && row.api_keys.length > 0 ? row.api_keys : [{ name: 'Default', key: row.api_key, enabled: true }],
    apiKeyStrategy: row.api_key_strategy ?? 'random',
    priority: row.priority,
    enabled: row.enabled,
    archived: row.archived ?? false,
    healthStatus: row.health_status ?? 'unknown',
    lastHealthCheck: row.last_health_check ?? null,
    totalRequests: row.request_count ?? 0,
    successCount: (row.request_count ?? 0) - (row.error_count ?? 0),
    errorCount: row.error_count ?? 0,
    avgLatencyMs: row.avg_latency ?? 0,
    rateLimitRemaining: row.rate_limit_remaining ?? null,
    rateLimitReset: row.rate_limit_reset ?? null,
    rateLimitTotal: row.rate_limit_total ?? null,
    createdAt: row.created_at,
  };
}

function dbToConfig(row: any): AppConfig {
  return {
    mode: row.mode ?? 'failover',
    razoterApiKey: row.razoter_api_key ?? (process.env.RAZOTER_API_KEY || 'razoter-default-key-change-me'),
    maxRetries: row.max_retries ?? 3,
    timeoutMs: row.timeout_ms ?? 30000,
  };
}

function dbToLog(row: any): RequestLog {
  return {
    id: row.id,
    providerId: row.provider_id,
    providerName: row.provider_name,
    model: row.model,
    status: row.status,
    statusCode: row.status_code ?? null,
    latencyMs: row.latency_ms,
    tokensUsed: row.tokens_used ?? null,
    errorMessage: row.error_message ?? null,
    apiKeyName: row.api_key_name ?? undefined,
    createdAt: row.timestamp ?? row.created_at,
  };
}

// ─── Rate Limiting (in-memory) ─────────────────────────

export function checkRateLimit(ip: string): { allowed: boolean; limit: number; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);

  if (!entry || now > entry.resetAt) {
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

export async function getProviders(includeArchived = false): Promise<Provider[]> {
  let query = supabase
    .from('providers')
    .select('*')
    .order('priority', { ascending: true });
  if (!includeArchived) query = query.eq('archived', false);

  const { data, error } = await query;

  if (error) {
    console.error('Supabase getProviders error:', error);
    return [];
  }
  return (data ?? []).map(dbToProvider);
}

export async function archiveProvider(id: string, archived: boolean): Promise<boolean> {
  const { error } = await supabase
    .from('providers')
    .update({ archived })
    .eq('id', id);

  if (error) {
    console.error('Supabase archiveProvider error:', error);
    return false;
  }
  return true;
}

export async function getProvider(id: string): Promise<Provider | undefined> {
  const { data, error } = await supabase
    .from('providers')
    .select('*')
    .eq('id', id)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Supabase getProvider error:', error);
    return undefined;
  }
  return data ? dbToProvider(data) : undefined;
}

export async function addProvider(data: {
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  selectedModels: string[];
  priority: number;
  enabled: boolean;
}): Promise<Provider> {
  const id = randomUUID();
  const now = new Date().toISOString();

  const insertRow = {
    id,
    name: data.name,
    base_url: data.baseUrl,
    api_key: data.apiKey,
    api_keys: Array.isArray((data as any).apiKeys) && (data as any).apiKeys.length > 0 ? (data as any).apiKeys : [{ name: 'Default', key: data.apiKey, enabled: true }],
    api_key_strategy: (data as any).apiKeyStrategy ?? 'random',
    auth_type: (data as any).authType ?? 'api_key',
    chatgpt_refresh_token: (data as any).chatgptRefreshToken ?? null,
    chatgpt_expires_at: (data as any).chatgptExpiresAt ?? null,
    models: data.models,
    selected_models: data.selectedModels,
    model: data.selectedModels[0] || data.models[0] || '', // backward compat
    priority: data.priority,
    enabled: data.enabled,
    created_at: now,
    request_count: 0,
    error_count: 0,
    avg_latency: 0,
    health_status: 'unknown',
  };

  const { data: inserted, error } = await supabase
    .from('providers')
    .insert(insertRow)
    .select()
    .single();

  if (error) {
    console.error('Supabase addProvider error:', error);
    throw new Error(`Failed to add provider: ${error.message}`);
  }
  return dbToProvider(inserted);
}

export async function updateProvider(id: string, data: Partial<Provider>): Promise<Provider | null> {
  const updateObj: Record<string, any> = {};
  if (data.name !== undefined) updateObj.name = data.name;
  if (data.baseUrl !== undefined) updateObj.base_url = data.baseUrl;
  if (data.apiKey !== undefined) updateObj.api_key = data.apiKey;
  if ((data as any).apiKeys !== undefined) updateObj.api_keys = (data as any).apiKeys;
  if ((data as any).authType !== undefined) updateObj.auth_type = (data as any).authType;
  if ((data as any).chatgptRefreshToken !== undefined) updateObj.chatgpt_refresh_token = (data as any).chatgptRefreshToken;
  if ((data as any).chatgptExpiresAt !== undefined) updateObj.chatgpt_expires_at = (data as any).chatgptExpiresAt;
  if (data.models !== undefined) updateObj.models = data.models;
  if (data.selectedModels !== undefined) {
    updateObj.selected_models = data.selectedModels;
    updateObj.model = data.selectedModels[0] || ''; // backward compat
  }
  if (data.priority !== undefined) updateObj.priority = data.priority;
  if (data.enabled !== undefined) updateObj.enabled = data.enabled;
  if (data.healthStatus !== undefined) updateObj.health_status = data.healthStatus;
  if ((data as any).apiKeyStrategy !== undefined) updateObj.api_key_strategy = (data as any).apiKeyStrategy;
  if (data.lastHealthCheck !== undefined) updateObj.last_health_check = data.lastHealthCheck;
  if (data.totalRequests !== undefined) updateObj.request_count = data.totalRequests;
  if (data.errorCount !== undefined) updateObj.error_count = data.errorCount;
  if (data.avgLatencyMs !== undefined) updateObj.avg_latency = data.avgLatencyMs;
  if (data.rateLimitRemaining !== undefined) updateObj.rate_limit_remaining = data.rateLimitRemaining;
  if (data.rateLimitReset !== undefined) updateObj.rate_limit_reset = data.rateLimitReset;
  if (data.rateLimitTotal !== undefined) updateObj.rate_limit_total = data.rateLimitTotal;

  const { data: updated, error } = await supabase
    .from('providers')
    .update(updateObj)
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) {
    console.error('Supabase updateProvider error:', error);
    return null;
  }
  return updated ? dbToProvider(updated) : null;
}

export async function deleteProvider(id: string): Promise<boolean> {
  const { error, count } = await supabase
    .from('providers')
    .delete({ count: 'exact' })
    .eq('id', id);

  if (error) {
    console.error('Supabase deleteProvider error:', error);
    return false;
  }
  return (count ?? 0) > 0;
}

export async function getEnabledProviders(): Promise<Provider[]> {
  const { data, error } = await supabase
    .from('providers')
    .select('*')
    .eq('enabled', true)
    .eq('archived', false)
    .order('priority', { ascending: true });

  if (error) {
    console.error('Supabase getEnabledProviders error:', error);
    return [];
  }
  return (data ?? []).map(dbToProvider);
}

export async function updateProviderStats(providerId: string, success: boolean, latencyMs: number): Promise<void> {
  const provider = await getProvider(providerId);
  if (!provider) return;

  const prevCount = provider.totalRequests || 0;
  const newRequestCount = prevCount + 1;
  const newErrorCount = (provider.errorCount || 0) + (success ? 0 : 1);

  // Guard against divide-by-zero on first request
  const newAvgLatency = prevCount === 0
    ? latencyMs
    : Math.round((provider.avgLatencyMs * prevCount + latencyMs) / newRequestCount);

  const errorRate = newErrorCount / newRequestCount;
  let healthStatus: string;
  if (errorRate < 0.1) healthStatus = 'healthy';
  else if (errorRate < 0.3) healthStatus = 'degraded';
  else healthStatus = 'down';

  const { error } = await supabase
    .from('providers')
    .update({
      request_count: newRequestCount,
      error_count: newErrorCount,
      avg_latency: newAvgLatency,
      health_status: healthStatus,
    })
    .eq('id', providerId);

  if (error) {
    console.error('Supabase updateProviderStats error:', error);
  }
}

export async function updateProviderRateLimit(
  providerId: string,
  remaining: number | undefined,
  reset: number | undefined,
  total: number | undefined
): Promise<void> {
  const updateObj: Record<string, any> = {};
  if (remaining !== undefined) updateObj.rate_limit_remaining = remaining;
  if (reset !== undefined) updateObj.rate_limit_reset = reset;
  if (total !== undefined) updateObj.rate_limit_total = total;

  if (Object.keys(updateObj).length === 0) return;

  const { error } = await supabase
    .from('providers')
    .update(updateObj)
    .eq('id', providerId);

  if (error) {
    console.error('Supabase updateProviderRateLimit error:', error);
  }
}

// ─── Config ───────────────────────────────────────────────

export async function getConfig(): Promise<AppConfig> {
  const { data, error } = await supabase
    .from('app_config')
    .select('*')
    .eq('id', 1)
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    console.error('Supabase getConfig error:', error);
    return {
      mode: 'failover',
      razoterApiKey: process.env.RAZOTER_API_KEY || 'razoter-default-key-change-me',
      maxRetries: 3,
      timeoutMs: 30000,
    };
  }
  return dbToConfig(data);
}

export async function updateConfig(data: Partial<AppConfig>): Promise<AppConfig> {
  const updateObj: Record<string, any> = {};
  if (data.mode !== undefined) updateObj.mode = data.mode;
  if (data.razoterApiKey !== undefined) updateObj.razoter_api_key = data.razoterApiKey;
  if (data.maxRetries !== undefined) updateObj.max_retries = data.maxRetries;
  if (data.timeoutMs !== undefined) updateObj.timeout_ms = data.timeoutMs;
  updateObj.updated_at = new Date().toISOString();

  const { data: updated, error } = await supabase
    .from('app_config')
    .update(updateObj)
    .eq('id', 1)
    .select()
    .maybeSingle();

  if (error) {
    console.error('Supabase updateConfig error:', error);
    const current = await getConfig();
    return { ...current, ...data };
  }

  return updated ? dbToConfig(updated) : await getConfig();
}

export function getRoundRobinIndex(): number {
  return roundRobinIndex;
}

export function incrementRoundRobinIndex(max: number): number {
  roundRobinIndex = (roundRobinIndex + 1) % max;
  return roundRobinIndex;
}

// ─── Logs ─────────────────────────────────────────────────

export async function addLog(log: Omit<RequestLog, 'id' | 'createdAt'>): Promise<RequestLog> {
  const id = randomUUID();
  const timestamp = new Date().toISOString();

  const insertRow = {
    id,
    timestamp,
    provider_id: log.providerId,
    provider_name: log.providerName,
    model: log.model,
    status: log.status,
    status_code: log.statusCode ?? null,
    latency_ms: log.latencyMs,
    error_message: log.errorMessage ?? null,
    tokens_used: log.tokensUsed ?? null,
    api_key_name: log.apiKeyName ?? null,
  };

  const { data, error } = await supabase
    .from('request_logs')
    .insert(insertRow)
    .select()
    .single();

  if (error) {
    console.error('Supabase addLog error:', error);
    return { ...log, id, createdAt: timestamp };
  }

  // Auto-delete oldest logs if total exceeds 15
  try {
    const { count } = await supabase
      .from('request_logs')
      .select('*', { count: 'exact', head: true });
    if (count && count > 15) {
      // Get IDs of logs beyond the latest 15
      const { data: oldLogs } = await supabase
        .from('request_logs')
        .select('id')
        .order('timestamp', { ascending: false })
        .range(15, count - 1);
      if (oldLogs && oldLogs.length > 0) {
        await supabase
          .from('request_logs')
          .delete()
          .in('id', oldLogs.map((l: any) => l.id));
      }
    }
  } catch (cleanupErr) {
    console.error('Log auto-cleanup error:', cleanupErr);
  }

  return dbToLog(data);
}

export async function getLogs(limit = 50, offset = 0): Promise<RequestLog[]> {
  const { data, error } = await supabase
    .from('request_logs')
    .select('*')
    .order('timestamp', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error('Supabase getLogs error:', error);
    return [];
  }
  return (data ?? []).map(dbToLog);
}

export async function clearLogs(): Promise<void> {
  const { error } = await supabase
    .from('request_logs')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');

  if (error) {
    console.error('Supabase clearLogs error:', error);
  }
}

export async function getLogsCount(): Promise<number> {
  const { count, error } = await supabase
    .from('request_logs')
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.error('Supabase getLogsCount error:', error);
    return 0;
  }
  return count ?? 0;
}

// ─── API Keys ────────────────────────────────────────────

export async function getApiKeys(): Promise<ApiKey[]> {
  const { data, error } = await supabase
    .from('api_keys')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Supabase getApiKeys error:', error);
    return [];
  }
  return (data ?? []).map(row => ({
    id: row.id,
    name: row.name,
    key: row.key,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at ?? null,
  }));
}

export async function addApiKey(name: string, key: string): Promise<ApiKey> {
  const id = randomUUID();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('api_keys')
    .insert({ id, name, key, created_at: now })
    .select()
    .single();

  if (error) {
    console.error('Supabase addApiKey error:', error);
    throw new Error(`Failed to add API key: ${error.message}`);
  }

  return { id: data.id, name: data.name, key: data.key, createdAt: data.created_at, lastUsedAt: null };
}

export async function deleteApiKey(id: string): Promise<boolean> {
  const { error, count } = await supabase
    .from('api_keys')
    .delete({ count: 'exact' })
    .eq('id', id);

  if (error) {
    console.error('Supabase deleteApiKey error:', error);
    return false;
  }
  return (count ?? 0) > 0;
}

// ─── Combos ──────────────────────────────────────────────

// In-memory round-robin index for combos (not persisted)
const comboRoundRobinIndex = new Map<string, number>();

export async function getCombos(): Promise<Combo[]> {
  const { data, error } = await supabase
    .from('combos')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Supabase getCombos error:', error);
    return [];
  }
  return (data ?? []).map(row => ({
    id: row.id,
    name: row.name,
    items: row.items ?? [],
    strategy: row.strategy ?? 'failover-priority',
    enabled: row.enabled ?? true,
    createdAt: row.created_at,
  }));
}

export async function addCombo(name: string, items: Combo['items'], strategy: Combo['strategy'] = 'failover-priority'): Promise<Combo> {
  const id = randomUUID();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('combos')
    .insert({ id, name, items, strategy, enabled: true, created_at: now })
    .select()
    .single();

  if (error) {
    console.error('Supabase addCombo error:', error);
    throw new Error(`Failed to add combo: ${error.message}`);
  }

  return { id: data.id, name: data.name, items: data.items ?? [], strategy: data.strategy ?? 'failover-priority', enabled: data.enabled, createdAt: data.created_at };
}

export async function updateCombo(id: string, updates: Partial<Combo>): Promise<Combo | null> {
  const updateObj: Record<string, any> = {};
  if (updates.name !== undefined) updateObj.name = updates.name;
  if (updates.items !== undefined) updateObj.items = updates.items;
  if (updates.strategy !== undefined) updateObj.strategy = updates.strategy;
  if (updates.enabled !== undefined) updateObj.enabled = updates.enabled;

  const { data, error } = await supabase
    .from('combos')
    .update(updateObj)
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) {
    console.error('Supabase updateCombo error:', error);
    return null;
  }
  if (!data) return null;

  return { id: data.id, name: data.name, items: data.items ?? [], strategy: data.strategy ?? 'failover-priority', enabled: data.enabled, createdAt: data.created_at };
}

export async function deleteCombo(id: string): Promise<boolean> {
  const { error, count } = await supabase
    .from('combos')
    .delete({ count: 'exact' })
    .eq('id', id);

  if (error) {
    console.error('Supabase deleteCombo error:', error);
    return false;
  }
  return (count ?? 0) > 0;
}

// ─── Combo resolution ────────────────────────────────────

export async function resolveComboModel(
  modelName: string,
  triedIndices?: number[]
): Promise<{ providerId: string; model: string; itemIndex: number } | null> {
  const { data, error } = await supabase
    .from('combos')
    .select('items, strategy')
    .eq('name', modelName)
    .eq('enabled', true)
    .limit(1)
    .maybeSingle();

  if (error || !data || !data.items || data.items.length === 0) {
    return null;
  }

  const items = data.items as Combo['items'];
  const strategy = (data.strategy as Combo['strategy']) ?? 'failover-priority';

  if (strategy === 'round-robin') {
    const idx = comboRoundRobinIndex.get(modelName) ?? 0;
    const nextIdx = idx % items.length;
    comboRoundRobinIndex.set(modelName, idx + 1);
    return { providerId: items[nextIdx].providerId, model: items[nextIdx].model, itemIndex: nextIdx };
  } else {
    // failover-priority: try items in order, skip already-tried ones
    const tried = new Set(triedIndices ?? []);
    for (let i = 0; i < items.length; i++) {
      if (!tried.has(i)) {
        return { providerId: items[i].providerId, model: items[i].model, itemIndex: i };
      }
    }
    return null;
  }
}

// ─── Quotas ──────────────────────────────────────────────

export async function getQuotas(): Promise<Quota[]> {
  const { data, error } = await supabase
    .from('quotas')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Supabase getQuotas error:', error);
    return [];
  }
  return (data ?? []).map(row => ({
    id: row.id,
    providerId: row.provider_id,
    providerName: row.provider_name,
    model: row.model ?? '',
    apiKeyName: row.api_key_name ?? '',
    monthlyLimit: row.monthly_limit ?? 0,
    currentUsage: row.current_usage ?? 0,
    resetDay: row.reset_day ?? 1,
    createdAt: row.created_at,
  }));
}

export async function addQuota(providerId: string, providerName: string, model: string, monthlyLimit: number, resetDay: number, apiKeyName: string = ''): Promise<Quota> {
  const id = randomUUID();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('quotas')
    .insert({ id, provider_id: providerId, provider_name: providerName, model: model || '', monthly_limit: monthlyLimit, current_usage: 0, reset_day: resetDay, api_key_name: apiKeyName, created_at: now })
    .select()
    .single();

  if (error) {
    console.error('Supabase addQuota error:', error);
    throw new Error(`Failed to add quota: ${error.message}`);
  }

  return { id: data.id, providerId: data.provider_id, providerName: data.provider_name, model: data.model ?? '', apiKeyName: data.api_key_name ?? '', monthlyLimit: data.monthly_limit, currentUsage: data.current_usage, resetDay: data.reset_day, createdAt: data.created_at };
}

export async function updateQuota(id: string, updates: Partial<Quota>): Promise<Quota | null> {
  const updateObj: Record<string, any> = {};
  if (updates.monthlyLimit !== undefined) updateObj.monthly_limit = updates.monthlyLimit;
  if (updates.resetDay !== undefined) updateObj.reset_day = updates.resetDay;

  const { data, error } = await supabase
    .from('quotas')
    .update(updateObj)
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) {
    console.error('Supabase updateQuota error:', error);
    return null;
  }
  if (!data) return null;

  return { id: data.id, providerId: data.provider_id, providerName: data.provider_name, model: data.model ?? '', apiKeyName: data.api_key_name ?? '', monthlyLimit: data.monthly_limit, currentUsage: data.current_usage, resetDay: data.reset_day, createdAt: data.created_at };
}

export async function deleteQuota(id: string): Promise<boolean> {
  const { error, count } = await supabase
    .from('quotas')
    .delete({ count: 'exact' })
    .eq('id', id);

  if (error) {
    console.error('Supabase deleteQuota error:', error);
    return false;
  }
  return (count ?? 0) > 0;
}

export async function incrementQuotaUsage(providerId: string, tokens: number, apiKeyName?: string): Promise<void> {
  if (!tokens || tokens <= 0) return;

  // Find quota entry by provider_id AND api_key_name (if provided)
  let queryBuilder = supabase
    .from('quotas')
    .select('id, current_usage')
    .eq('provider_id', providerId);

  if (apiKeyName) {
    queryBuilder = queryBuilder.eq('api_key_name', apiKeyName);
  }

  const { data } = await queryBuilder.limit(1).maybeSingle();

  if (data) {
    await supabase
      .from('quotas')
      .update({ current_usage: (data.current_usage ?? 0) + tokens })
      .eq('id', data.id);
  } else if (apiKeyName) {
    // No entry for this api_key_name — try provider-level entry (api_key_name = '' or null)
    // Avoid .or() empty-string filter (broken in PostgREST); fetch and filter in code.
    const { data: candidates } = await supabase
      .from('quotas')
      .select('id, current_usage, api_key_name')
      .eq('provider_id', providerId);

    const fallback = (candidates || []).find(
      (q: any) => q.api_key_name === null || q.api_key_name === ''
    );

    if (fallback) {
      await supabase
        .from('quotas')
        .update({ current_usage: (fallback.current_usage ?? 0) + tokens })
        .eq('id', fallback.id);
    }
    // If still no entry, do nothing — no quota configured for this provider
  }
}

export async function checkQuotaLimit(providerId: string, apiKeyName?: string): Promise<boolean> {
  // Returns true if provider is within quota (or no quota set)
  let queryBuilder = supabase
    .from('quotas')
    .select('monthly_limit, current_usage')
    .eq('provider_id', providerId);

  if (apiKeyName) {
    queryBuilder = queryBuilder.eq('api_key_name', apiKeyName);
  }

  const { data, error } = await queryBuilder.limit(1).maybeSingle();

  // DB error: fail closed (block request) rather than silently bypassing quota.
  if (error) {
    console.error('Supabase checkQuotaLimit error:', error);
    return false;
  }

  if (!data || !data.monthly_limit || data.monthly_limit === 0) return true; // no limit
  return (data.current_usage ?? 0) < data.monthly_limit;
}
