-- Razoter Database Schema for Supabase

-- Providers table
CREATE TABLE IF NOT EXISTS providers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    api_key TEXT NOT NULL,
    model TEXT NOT NULL,
    priority INTEGER DEFAULT 10,
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_used TIMESTAMP WITH TIME ZONE,
    request_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    avg_latency INTEGER DEFAULT 0,
    health_status TEXT DEFAULT 'unknown',
    rate_limit_remaining INTEGER,
    rate_limit_total INTEGER,
    rate_limit_reset TIMESTAMP WITH TIME ZONE
);

-- Request logs table
CREATE TABLE IF NOT EXISTS request_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    provider_id UUID REFERENCES providers(id) ON DELETE SET NULL,
    provider_name TEXT,
    model TEXT,
    status TEXT NOT NULL,
    status_code INTEGER,
    latency_ms INTEGER NOT NULL,
    error_message TEXT,
    tokens_used INTEGER
);

-- App config table (single row)
CREATE TABLE IF NOT EXISTS app_config (
    id INTEGER PRIMARY KEY DEFAULT 1,
    mode TEXT DEFAULT 'failover',
    razoter_api_key TEXT DEFAULT 'razote...e-me',
    max_retries INTEGER DEFAULT 3,
    timeout_ms INTEGER DEFAULT 30000,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default config if not exists
INSERT INTO app_config (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Enable RLS
ALTER TABLE providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Allow all for service role" ON providers USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for service role" ON request_logs USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for service role" ON app_config USING (true) WITH CHECK (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_providers_enabled ON providers(enabled);
CREATE INDEX IF NOT EXISTS idx_providers_priority ON providers(priority);
CREATE INDEX IF NOT EXISTS idx_request_logs_timestamp ON request_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_request_logs_provider_id ON request_logs(provider_id);
