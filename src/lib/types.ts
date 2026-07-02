// ─── Provider types ─────────────────────────────────

export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  selectedModels: string[];
  priority: number;
  enabled: boolean;
  healthStatus: 'healthy' | 'degraded' | 'down' | 'unknown';
  lastHealthCheck: string | null;
  totalRequests: number;
  successCount: number;
  errorCount: number;
  avgLatencyMs: number;
  rateLimitRemaining: number | null;
  rateLimitReset: number | null;
  rateLimitTotal: number | null;
  createdAt: string;
}

// ─── API Key types ──────────────────────────────────

export interface ApiKey {
  id: string;
  name: string;
  key: string;
  createdAt: string;
  lastUsedAt: string | null;
}

// ─── Combo types ────────────────────────────────────

export interface ComboItem {
  providerId: string;
  providerName: string;
  model: string;
}

export interface Combo {
  id: string;
  name: string;
  items: ComboItem[];
  enabled: boolean;
  createdAt: string;
}

// ─── Config types ───────────────────────────────────

export type RotationMode = 'failover' | 'round-robin' | 'priority';

export interface AppConfig {
  mode: RotationMode;
  maxRetries: number;
  timeoutMs: number;
  razoterApiKey: string;
}

// ─── Log types ──────────────────────────────────────

export interface RequestLog {
  id: string;
  providerId: string;
  providerName: string;
  model: string;
  status: 'success' | 'error' | 'timeout' | 'retry';
  statusCode?: number | null;
  latencyMs: number;
  tokensUsed?: number | null;
  errorMessage?: string | null;
  createdAt: string;
}

// ─── Stats types ────────────────────────────────────

export interface ProviderBreakdown {
  providerId: string;
  providerName: string;
  requests: number;
  successes: number;
  errors: number;
  avgLatency: number;
}

export interface Stats {
  totalRequests: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  avgLatency: number;
  providerBreakdown: ProviderBreakdown[];
}

// ─── Rate limit ─────────────────────────────────────

export interface RateLimitEntry {
  count: number;
  resetAt: number;
}
