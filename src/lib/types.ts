export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  priority: number;
  enabled: boolean;
  createdAt: string;
  lastUsed?: string;
  requestCount: number;
  errorCount: number;
  avgLatency: number;
  healthStatus: 'healthy' | 'degraded' | 'down' | 'unknown';
  rateLimitRemaining?: number;
  rateLimitReset?: number; // Unix timestamp (seconds) when limit resets
  rateLimitTotal?: number;
}

export type RotationMode = 'failover' | 'round-robin' | 'priority';

export interface AppConfig {
  mode: RotationMode;
  razoterApiKey: string;
  maxRetries: number;
  timeoutMs: number;
}

export interface RequestLog {
  id: string;
  timestamp: string;
  providerId: string;
  providerName: string;
  model: string;
  status: 'success' | 'error' | 'timeout' | 'retry';
  statusCode?: number;
  latencyMs: number;
  errorMessage?: string;
  tokensUsed?: number;
}

export interface Stats {
  totalRequests: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  avgLatency: number;
  providerBreakdown: {
    providerId: string;
    providerName: string;
    requests: number;
    successes: number;
    errors: number;
    avgLatency: number;
  }[];
}

export interface RateLimitEntry {
  count: number;
  resetAt: number; // Unix timestamp (ms) when the window resets
}
