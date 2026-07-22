import { Provider, AppConfig, RequestLog, RateLimitEntry, ApiKey, Combo, Quota } from './types';
import { supabase } from './supabase';
import { randomUUID } from 'crypto';

// In-memory round-robin index (not persisted)
let roundRobinIndex = 0;

// Rate limiting per IP (in-memory, resets on cold start - acceptable for serverless)
const rateLimitStore = new Map<string, RateLimitEntry>();

const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '60');
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000');

// Explicit provider column list — ensures columns added later (api_keys, api_key_strategy)
// are always returned even if the Supabase schema cache is stale with select('*').
const PROVIDER_COLUMNS = 'id, name, base_url, api_key, auth_type, chatgpt_refresh_token, chatgpt_expires_at, models, selected_models, api_keys, api_key_strategy, priority, enabled, archived, health_status, last_health_check, request_count, error_count, avg_latency, rate_limit_remaining, rate_limit_reset, rate_limit_total, created_at';

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
    apiKeys: (() => {
      let raw = row.api_keys;
      if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = []; } }
      return Array.isArray(raw) && raw.length > 0 ? raw : [{ name: 'Default', key: row.api_key, enabled: true }];
    })(),
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
    maxRetries: row.max_retries ?? 20,
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

/**
 * Get providers.
 * - mode 'active' (default): only non-archived (Providers tab)
 * - mode 'archived': only archived (Arsip tab / recycle bin)
 * - mode 'all': everything
 */
export async function getProviders(mode: 'active' | 'archived' | 'all' = 'active'): Promise<Provider[]> {
  let query = supabase
    .from('providers')
    .select(PROVIDER_COLUMNS)
    .order('priority', { ascending: true });

  if (mode === 'active') query = query.eq('archived', false);
  if (mode === 'archived') query = query.eq('archived', true);

  const { data, error } = await query;

  if (error) {
    console.error('Supabase getProviders error:', error);
    return [];
  }
  return (data ?? []).map(dbToProvider);
}

export async function getEnabledProviders(): Promise<Provider[]> {
  const { data, error } = await supabase
    .from('providers')
    .select(PROVIDER_COLUMNS)
    .eq('enabled', true)
    .eq('archived', false)
    .order('priority', { ascending: true });

  if (error) {
    console.error('Supabase getEnabledProviders error:', error);
    return [];
  }
  return (data ?? []).map(dbToProvider);
}

/** Soft-hide / restore provider (recycle-bin style). Keeps all settings. */
export async function archiveProvider(id: string, archived: boolean): Promise<boolean> {
  const { data, error } = await supabase
    .from('providers')
    .update({ archived })
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('Supabase archiveProvider error:', error);
    return false;
  }
  return !!data;
}

export async function getProvider(id: string): Promise<Provider | undefined> {
  const { data, error } = await supabase
    .from('providers')
    .select(PROVIDER_COLUMNS)
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
  apiKeys?: Array<{ name: string; key: string; enabled: boolean }>;
  apiKeyStrategy?: 'random' | 'failover-priority' | 'round-robin';
  authType?: 'api_key' | 'chatgpt_plus';
  chatgptRefreshToken?: string;
  chatgptExpiresAt?: string;
}): Promise<Provider> {
  const id = randomUUID();
  const now = new Date().toISOString();

  const insertRow = {
    id,
    name: data.name,
    base_url: data.baseUrl,
    api_key: data.apiKey,
    api_keys: Array.isArray(data.apiKeys) && data.apiKeys.length > 0
      ? data.apiKeys
      : [{ name: 'Default', key: data.apiKey, enabled: true }],
    api_key_strategy: data.apiKeyStrategy ?? 'random',
    auth_type: data.authType ?? 'api_key',
    chatgpt_refresh_token: data.chatgptRefreshToken ?? null,
    chatgpt_expires_at: data.chatgptExpiresAt ?? null,
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
  const updateObj: Record<string, unknown> = {};
  if (data.name !== undefined) updateObj.name = data.name;
  if (data.baseUrl !== undefined) updateObj.base_url = data.baseUrl;
  if (data.apiKey !== undefined) updateObj.api_key = data.apiKey;
  if (data.apiKeys !== undefined) updateObj.api_keys = data.apiKeys;
  if (data.authType !== undefined) updateObj.auth_type = data.authType;
  if (data.chatgptRefreshToken !== undefined) updateObj.chatgpt_refresh_token = data.chatgptRefreshToken;
  if (data.chatgptExpiresAt !== undefined) updateObj.chatgpt_expires_at = data.chatgptExpiresAt;
  if (data.models !== undefined) updateObj.models = data.models;
  if (data.selectedModels !== undefined) {
    updateObj.selected_models = data.selectedModels;
    updateObj.model = data.selectedModels[0] || ''; // backward compat
  }
  if (data.priority !== undefined) updateObj.priority = data.priority;
  if (data.enabled !== undefined) updateObj.enabled = data.enabled;
  if (data.archived !== undefined) updateObj.archived = data.archived;
  if (data.healthStatus !== undefined) updateObj.health_status = data.healthStatus;
  if (data.apiKeyStrategy !== undefined) updateObj.api_key_strategy = data.apiKeyStrategy;
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
  // Fetch provider first so we can clean up related quota records by provider name
  const provider = await getProvider(id);

  const { error, count } = await supabase
    .from('providers')
    .delete({ count: 'exact' })
    .eq('id', id);

  if (error) {
    console.error('Supabase deleteProvider error:', error);
    return false;
  }

  // Cascade: remove quota tracking rows tied to this provider (by id and by name)
  try {
    await supabase.from('quotas').delete().eq('provider_id', id);
    if (provider?.name) {
      await supabase.from('quotas').delete().eq('provider_name', provider.name);
    }
  } catch (e) {
    console.error('Supabase deleteProvider quota cascade error:', e);
  }

  return (count ?? 0) > 0;
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
      maxRetries: 20,
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

/**
 * Full Logs-tab reset:
 * - wipe request_logs
 * - zero quotas.current_usage (so Per API Key / limit usage starts over)
 * - wipe lifetime token totals if table exists
 *
 * Does NOT delete quota limit settings (monthly_limit stays).
 */
export async function resetLogsAndUsageCounters(): Promise<{
  logsCleared: boolean;
  quotasReset: number;
  lifetimeReset: boolean;
}> {
  let logsCleared = true;
  let quotasReset = 0;
  let lifetimeReset = false;

  const { error: logErr } = await supabase
    .from('request_logs')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');
  if (logErr) {
    console.error('resetLogsAndUsageCounters clear logs error:', logErr);
    logsCleared = false;
  }

  // Zero all quota usage counters (limits stay intact)
  const { data: quotaRows, error: qErr } = await supabase
    .from('quotas')
    .select('id, current_usage');
  if (qErr) {
    console.error('resetLogsAndUsageCounters list quotas error:', qErr);
  } else {
    const toReset = (quotaRows || []).filter(
      (r: { current_usage?: number | null }) => (r.current_usage ?? 0) !== 0
    );
    if (toReset.length > 0) {
      // Bulk update all non-zero rows
      const { error: uErr, count } = await supabase
        .from('quotas')
        .update({ current_usage: 0 })
        .gt('current_usage', 0)
        .select('id', { count: 'exact', head: true });
      if (uErr) {
        // Fallback: per-row update
        console.error('resetLogsAndUsageCounters bulk quota reset error:', uErr);
        for (const row of toReset as Array<{ id: string }>) {
          const { error } = await supabase
            .from('quotas')
            .update({ current_usage: 0 })
            .eq('id', row.id);
          if (!error) quotasReset += 1;
        }
      } else {
        quotasReset = count ?? toReset.length;
      }
    }
  }

  // Lifetime table (if present)
  const ok = await ensureLifetimeTokenTable();
  if (ok) {
    const { error: lifeErr } = await supabase
      .from('api_key_token_totals')
      .delete()
      .neq('api_key_name', '__never__');
    if (lifeErr) {
      // try zero instead of delete
      const { error: zErr } = await supabase
        .from('api_key_token_totals')
        .update({ total_tokens: 0, total_requests: 0, updated_at: new Date().toISOString() })
        .gt('total_tokens', -1);
      if (zErr) console.error('resetLogsAndUsageCounters lifetime reset error:', zErr);
      else lifetimeReset = true;
    } else {
      lifetimeReset = true;
    }
  }

  return { logsCleared, quotasReset, lifetimeReset };
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
): Promise<{ providerId: string; model: string; itemIndex: number; apiKeyName?: string } | null> {
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

  // Filter out disabled items (enabled === false). Items without `enabled` field default to ON (backward compat).
  const activeItems = items.map((item, originalIndex) => ({ item, originalIndex }))
    .filter(({ item }) => item.enabled !== false);

  if (activeItems.length === 0) {
    return null; // all items disabled
  }

  if (strategy === 'round-robin') {
    const tried = new Set(triedIndices ?? []);
    const idx = comboRoundRobinIndex.get(modelName) ?? 0;
    // Try each active item starting from round-robin index, skip already-tried ones
    for (let offset = 0; offset < activeItems.length; offset++) {
      const nextPos = (idx + offset) % activeItems.length;
      const { item, originalIndex } = activeItems[nextPos];
      if (!tried.has(originalIndex)) {
        comboRoundRobinIndex.set(modelName, nextPos + 1);
        return { providerId: item.providerId, model: item.model, itemIndex: originalIndex, apiKeyName: item.apiKeyName };
      }
    }
    return null; // all active items exhausted
  } else {
    // failover-priority: try active items in order, skip already-tried ones
    const tried = new Set(triedIndices ?? []);
    for (const { item, originalIndex } of activeItems) {
      if (!tried.has(originalIndex)) {
        return { providerId: item.providerId, model: item.model, itemIndex: originalIndex, apiKeyName: item.apiKeyName };
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
  const updateObj: Record<string, unknown> = {};
  if (updates.monthlyLimit !== undefined) updateObj.monthly_limit = updates.monthlyLimit;
  if (updates.resetDay !== undefined) updateObj.reset_day = updates.resetDay;
  if (updates.currentUsage !== undefined) updateObj.current_usage = updates.currentUsage;
  if (updates.model !== undefined) updateObj.model = updates.model;
  if (updates.apiKeyName !== undefined) updateObj.api_key_name = updates.apiKeyName;
  if (updates.providerName !== undefined) updateObj.provider_name = updates.providerName;

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

type QuotaRow = {
  id: string;
  provider_id: string;
  provider_name?: string;
  model?: string | null;
  api_key_name?: string | null;
  monthly_limit?: number | null;
  current_usage?: number | null;
  reset_day?: number | null;
};

async function listQuotasForProvider(providerId: string): Promise<QuotaRow[]> {
  const { data, error } = await supabase
    .from('quotas')
    .select('id, provider_id, provider_name, model, api_key_name, monthly_limit, current_usage, reset_day')
    .eq('provider_id', providerId);
  if (error) {
    console.error('Supabase listQuotasForProvider error:', error);
    return [];
  }
  return (data || []) as QuotaRow[];
}

function pickQuotaRows(
  rows: QuotaRow[],
  opts: { apiKeyName?: string; model?: string }
): QuotaRow[] {
  const apiKeyName = (opts.apiKeyName || '').trim();
  const model = (opts.model || '').trim();

  // Prefer exact (apiKey + model), then (apiKey + all models), then provider-level.
  const exact = rows.filter(r =>
    (r.api_key_name || '') === apiKeyName &&
    (r.model || '') === model
  );
  if (exact.length) return exact;

  if (model) {
    const keyAllModels = rows.filter(r =>
      (r.api_key_name || '') === apiKeyName &&
      (!r.model || r.model === '')
    );
    if (keyAllModels.length) return keyAllModels;
  }

  if (apiKeyName) {
    const keyAny = rows.filter(r => (r.api_key_name || '') === apiKeyName);
    if (keyAny.length) return keyAny;
  }

  // Provider-level fallbacks (empty api key name)
  const providerLevel = rows.filter(r => !r.api_key_name || r.api_key_name === '');
  if (model) {
    const providerModel = providerLevel.filter(r => (r.model || '') === model);
    if (providerModel.length) return providerModel;
  }
  return providerLevel.filter(r => !r.model || r.model === '');
}

export async function incrementQuotaUsage(
  providerId: string,
  tokens: number,
  apiKeyName?: string,
  model?: string
): Promise<void> {
  if (!tokens || tokens <= 0) return;

  const rows = await listQuotasForProvider(providerId);
  if (rows.length === 0) return;

  // Increment every matching scoped quota row (key+model, key-all, provider-level if selected)
  const targets = new Map<string, QuotaRow>();
  for (const r of pickQuotaRows(rows, { apiKeyName, model })) targets.set(r.id, r);

  // Always also bump exact key-level all-models row if present, so "limit per API key" stays accurate
  // even when a model-specific row exists.
  if (apiKeyName) {
    for (const r of rows) {
      if ((r.api_key_name || '') === apiKeyName && (!r.model || r.model === '')) {
        targets.set(r.id, r);
      }
    }
  }

  await Promise.all(
    Array.from(targets.values()).map(async (row) => {
      await supabase
        .from('quotas')
        .update({ current_usage: (row.current_usage ?? 0) + tokens })
        .eq('id', row.id);
    })
  );

  // Lifetime total per API key (independent of request_logs cleanup)
  if (apiKeyName) {
    await incrementLifetimeApiKeyTokens(apiKeyName, tokens).catch((e) => {
      console.error('incrementLifetimeApiKeyTokens error:', e);
    });
  }
}

/**
 * Returns true if request is within quota (or no quota set).
 * Checks most-specific scope first: apiKey+model → apiKey → provider.
 * Any matching limited quota that is exhausted blocks the request.
 */
export async function checkQuotaLimit(
  providerId: string,
  apiKeyName?: string,
  model?: string
): Promise<boolean> {
  const rows = await listQuotasForProvider(providerId);
  // No rows → no limit configured
  if (rows.length === 0) return true;

  const candidates = pickQuotaRows(rows, { apiKeyName, model });
  // Also include exact key-level all-models if present
  if (apiKeyName) {
    for (const r of rows) {
      if ((r.api_key_name || '') === apiKeyName && (!r.model || r.model === '')) {
        if (!candidates.some(c => c.id === r.id)) candidates.push(r);
      }
    }
  }

  if (candidates.length === 0) return true;

  for (const row of candidates) {
    const limit = row.monthly_limit ?? 0;
    if (!limit || limit <= 0) continue; // unlimited
    if ((row.current_usage ?? 0) >= limit) return false;
  }
  return true;
}

// ─── Lifetime token totals per API key ───────────────────
// Stored separately so request_logs auto-trim (max 15) does not wipe totals.

let lifetimeTableReady: Promise<boolean> | null = null;

async function ensureLifetimeTokenTable(): Promise<boolean> {
  if (lifetimeTableReady) return lifetimeTableReady;
  lifetimeTableReady = (async () => {
    // Probe table existence with a cheap select
    const { error } = await supabase
      .from('api_key_token_totals')
      .select('api_key_name')
      .limit(1);
    if (!error) return true;
    // Table missing → create via SQL if possible. PostgREST can't DDL, so we
    // fall back to soft-disable and keep using quotas/current logs.
    console.error('api_key_token_totals missing or inaccessible:', error.message);
    return false;
  })();
  return lifetimeTableReady;
}

export async function incrementLifetimeApiKeyTokens(apiKeyName: string, tokens: number): Promise<void> {
  const name = (apiKeyName || '').trim();
  if (!name || !tokens || tokens <= 0) return;
  const ok = await ensureLifetimeTokenTable();
  if (!ok) return;

  const now = new Date().toISOString();
  const { data: existing } = await supabase
    .from('api_key_token_totals')
    .select('api_key_name, total_tokens, total_requests')
    .eq('api_key_name', name)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('api_key_token_totals')
      .update({
        total_tokens: (existing.total_tokens ?? 0) + tokens,
        total_requests: (existing.total_requests ?? 0) + 1,
        updated_at: now,
      })
      .eq('api_key_name', name);
  } else {
    await supabase
      .from('api_key_token_totals')
      .insert({
        api_key_name: name,
        total_tokens: tokens,
        total_requests: 1,
        updated_at: now,
      });
  }
}

export async function getLifetimeTokenByApiKey(): Promise<Array<{ key: string; tokens: number; requests: number; successes: number }>> {
  const ok = await ensureLifetimeTokenTable();
  if (ok) {
    const { data, error } = await supabase
      .from('api_key_token_totals')
      .select('api_key_name, total_tokens, total_requests')
      .order('total_tokens', { ascending: false });
    if (!error && data) {
      return data.map((row: { api_key_name: string; total_tokens: number; total_requests: number }) => ({
        key: row.api_key_name,
        tokens: row.total_tokens ?? 0,
        requests: row.total_requests ?? 0,
        successes: row.total_requests ?? 0,
      }));
    }
  }

  // Fallback: derive permanent-ish totals from quotas.current_usage (not wiped by log cleanup).
  // Prefer key-level rows (model empty) and aggregate by api_key_name.
  const { data: quotaRows, error: qErr } = await supabase
    .from('quotas')
    .select('api_key_name, model, current_usage');
  if (qErr || !quotaRows) {
    if (qErr) console.error('getLifetimeTokenByApiKey quota fallback error:', qErr);
    return [];
  }

  const map = new Map<string, { key: string; tokens: number; requests: number; successes: number }>();
  for (const row of quotaRows as Array<{ api_key_name?: string | null; model?: string | null; current_usage?: number | null }>) {
    const key = (row.api_key_name || '').trim() || 'Default';
    // Prefer all-models rows; if only model-specific exist, still count them.
    const isAllModels = !row.model || row.model === '';
    const prev = map.get(key) || { key, tokens: 0, requests: 0, successes: 0 };
    if (isAllModels) {
      // all-models row is authoritative for that key when present
      prev.tokens = Math.max(prev.tokens, row.current_usage ?? 0);
    } else if (prev.tokens === 0) {
      prev.tokens += row.current_usage ?? 0;
    }
    map.set(key, prev);
  }
  return Array.from(map.values()).sort((a, b) => b.tokens - a.tokens);
}

/**
 * Ensure a quota row exists for provider+apiKey (+ optional model).
 * Used by dashboard auto-sync / limit UI.
 */
export async function ensureQuotaRow(
  providerId: string,
  providerName: string,
  apiKeyName: string,
  model: string = '',
  monthlyLimit: number = 0,
  resetDay: number = 1
): Promise<Quota> {
  const rows = await listQuotasForProvider(providerId);
  const found = rows.find(r =>
    (r.api_key_name || '') === (apiKeyName || '') &&
    (r.model || '') === (model || '')
  );
  if (found) {
    return {
      id: found.id,
      providerId: found.provider_id,
      providerName: found.provider_name || providerName,
      model: found.model ?? '',
      apiKeyName: found.api_key_name ?? '',
      monthlyLimit: found.monthly_limit ?? 0,
      currentUsage: found.current_usage ?? 0,
      resetDay: found.reset_day ?? 1,
      createdAt: '',
    };
  }
  return addQuota(providerId, providerName, model, monthlyLimit, resetDay, apiKeyName);
}
