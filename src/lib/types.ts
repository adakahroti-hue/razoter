// ─── Provider types ─────────────────────────────────

export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];           // Array of model IDs this provider supports
  selectedModels: string[];   // Which models the user wants to use (subset of models)
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
