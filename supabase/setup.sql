-- ═══════════════════════════════════════════════════════════════════
-- RAZOTER — Complete Database Setup Script
-- ═══════════════════════════════════════════════════════════════════
-- This file combines all schema + migrations + RPC functions into ONE file.
-- Run this ONCE in your Supabase SQL Editor to set up the full database.
-- Safe to re-run (all statements use IF NOT EXISTS / OR REPLACE).
-- ═══════════════════════════════════════════════════════════════════


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- SECTION 1: CORE TABLES
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- providers: AI provider configurations (OpenAI, OpenRouter, etc.)
CREATE TABLE IF NOT EXISTS providers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    api_key TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
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

-- request_logs: API request history
CREATE TABLE IF NOT EXISTS request_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    provider_id UUID REFERENCES providers(id) ON DELETE SET NULL,
    provider_name TEXT,
    model TEXT,
    status TEXT NOT NULL DEFAULT 'ok',
    status_code INTEGER,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    tokens_used INTEGER
);

-- app_config: Global app settings (single row, id=1)
CREATE TABLE IF NOT EXISTS app_config (
    id INTEGER PRIMARY KEY DEFAULT 1,
    mode TEXT DEFAULT 'failover',
    razoter_api_key TEXT DEFAULT 'razote...e-me',
    max_retries INTEGER DEFAULT 3,
    timeout_ms INTEGER DEFAULT 30000,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- users: Dashboard login accounts
CREATE TABLE IF NOT EXISTS users (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login TIMESTAMP WITH TIME ZONE
);

-- api_keys: API keys for external clients to call the proxy
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    key TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_used_at TIMESTAMP WITH TIME ZONE
);

-- quotas: Monthly token/request limits per provider/model
CREATE TABLE IF NOT EXISTS quotas (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    provider_id UUID REFERENCES providers(id) ON DELETE CASCADE,
    provider_name TEXT DEFAULT '',
    model TEXT DEFAULT '',
    monthly_limit INTEGER DEFAULT 0,
    current_usage INTEGER DEFAULT 0,
    reset_day INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- combos: "Gabung" virtual models that merge multiple providers
CREATE TABLE IF NOT EXISTS combos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    items JSONB DEFAULT '[]'::jsonb,
    strategy TEXT DEFAULT 'failover-priority',
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- api_key_token_totals: Lifetime token usage per API key (survives log cleanup)
CREATE TABLE IF NOT EXISTS api_key_token_totals (
    api_key_name TEXT PRIMARY KEY,
    total_tokens BIGINT NOT NULL DEFAULT 0,
    total_requests INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default config if not exists
INSERT INTO app_config (id) VALUES (1) ON CONFLICT DO NOTHING;


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- SECTION 2: ROW LEVEL SECURITY (RLS)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALTER TABLE providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE combos ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_key_token_totals ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS — these policies allow full access
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'providers' AND policyname = 'Allow all for service role') THEN
    CREATE POLICY "Allow all for service role" ON providers USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'request_logs' AND policyname = 'Allow all for service role') THEN
    CREATE POLICY "Allow all for service role" ON request_logs USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'app_config' AND policyname = 'Allow all for service role') THEN
    CREATE POLICY "Allow all for service role" ON app_config USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'users' AND policyname = 'Allow all for service role') THEN
    CREATE POLICY "Allow all for service role" ON users USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'api_keys' AND policyname = 'Allow all for service role') THEN
    CREATE POLICY "Allow all for service role" ON api_keys USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'quotas' AND policyname = 'Allow all for service role') THEN
    CREATE POLICY "Allow all for service role" ON quotas USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'combos' AND policyname = 'Allow all for service role') THEN
    CREATE POLICY "Allow all for service role" ON combos USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'api_key_token_totals' AND policyname = 'Allow all for service role') THEN
    CREATE POLICY "Allow all for service role" ON api_key_token_totals USING (true) WITH CHECK (true);
  END IF;
END $$;


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- SECTION 3: ADDITIONAL COLUMNS (from migrations)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Migration 002: ChatGPT Plus OAuth support
ALTER TABLE providers ADD COLUMN IF NOT EXISTS auth_type TEXT DEFAULT 'api_key';
ALTER TABLE providers ADD COLUMN IF NOT EXISTS chatgpt_refresh_token TEXT;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS chatgpt_expires_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS models JSONB DEFAULT '[]'::jsonb;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS selected_models JSONB DEFAULT '[]'::jsonb;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS last_health_check TIMESTAMP WITH TIME ZONE;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS rate_limit_reset BIGINT;

-- Migration 004: Multi API key support (JSONB array)
ALTER TABLE providers ADD COLUMN IF NOT EXISTS api_keys JSONB DEFAULT '[]'::jsonb;

-- Migration 005: Per-API-key quota tracking
ALTER TABLE quotas ADD COLUMN IF NOT EXISTS api_key_name TEXT DEFAULT '';
ALTER TABLE quotas ADD COLUMN IF NOT EXISTS api_key_provider TEXT DEFAULT '';
UPDATE quotas SET model = '' WHERE model IS NULL;

-- Migration 006: Log which API key made each request
ALTER TABLE request_logs ADD COLUMN IF NOT EXISTS api_key_name TEXT DEFAULT '';

-- Migration 007: API key selection strategy
ALTER TABLE providers ADD COLUMN IF NOT EXISTS api_key_strategy TEXT DEFAULT 'random';
UPDATE providers SET api_key_strategy = 'random' WHERE api_key_strategy IS NULL;

-- Migration 008: Archive (soft-delete) providers
ALTER TABLE providers ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false;

-- Migration 004 data: Migrate existing single api_key into api_keys array
UPDATE providers
SET api_keys = jsonb_build_array(
  jsonb_build_object(
    'name', 'Default',
    'key', api_key,
    'enabled', true
  )
)
WHERE (api_keys = '[]'::jsonb OR api_keys IS NULL)
  AND api_key IS NOT NULL
  AND api_key != '';


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- SECTION 4: UNIQUE CONSTRAINTS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Clean up any duplicate quota rows before adding constraint
DELETE FROM quotas a USING quotas b
WHERE a.id > b.id
  AND a.provider_id = b.provider_id
  AND a.model = b.model
  AND a.api_key_name = b.api_key_name;

-- Drop old constraint if exists, then add the final version
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotas_provider_model_unique') THEN
    ALTER TABLE quotas DROP CONSTRAINT quotas_provider_model_unique;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotas_provider_model_key_unique') THEN
    ALTER TABLE quotas ADD CONSTRAINT quotas_provider_model_key_unique UNIQUE (provider_id, model, api_key_name);
  END IF;
END $$;


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- SECTION 5: INDEXES
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE INDEX IF NOT EXISTS idx_providers_enabled ON providers(enabled);
CREATE INDEX IF NOT EXISTS idx_providers_priority ON providers(priority);
CREATE INDEX IF NOT EXISTS idx_providers_archived ON providers(archived);
CREATE INDEX IF NOT EXISTS idx_request_logs_timestamp ON request_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_request_logs_provider_id ON request_logs(provider_id);
CREATE INDEX IF NOT EXISTS idx_quotas_provider_id ON quotas(provider_id);
CREATE INDEX IF NOT EXISTS idx_combos_name_enabled ON combos(name) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_api_key_token_totals_tokens ON api_key_token_totals(total_tokens DESC);


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- SECTION 6: RPC FUNCTIONS (Atomic operations)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 1. Atomic update_provider_stats (replaces read-then-write)
CREATE OR REPLACE FUNCTION update_provider_stats(
  p_provider_id UUID,
  p_success BOOLEAN,
  p_latency_ms INTEGER
) RETURNS VOID AS $$
DECLARE
  v_prev_count INTEGER;
  v_new_count INTEGER;
  v_new_error_count INTEGER;
  v_new_avg INTEGER;
  v_error_rate FLOAT;
  v_health TEXT;
BEGIN
  SELECT COALESCE(request_count, 0), COALESCE(error_count, 0), COALESCE(avg_latency, 0)
  INTO v_prev_count, v_new_error_count, v_new_avg
  FROM providers WHERE id = p_provider_id;

  v_new_count := v_prev_count + 1;
  v_new_error_count := v_new_error_count + CASE WHEN p_success THEN 0 ELSE 1 END;
  v_new_avg := CASE WHEN v_prev_count = 0 THEN p_latency_ms
    ELSE ROUND((v_new_avg * v_prev_count + p_latency_ms) / v_new_count) END;
  v_error_rate := v_new_error_count::FLOAT / v_new_count;
  v_health := CASE WHEN v_error_rate < 0.1 THEN 'healthy' WHEN v_error_rate < 0.3 THEN 'degraded' ELSE 'down' END;

  UPDATE providers SET
    request_count = v_new_count,
    error_count = v_new_error_count,
    avg_latency = v_new_avg,
    health_status = v_health
  WHERE id = p_provider_id;
END;
$$ LANGUAGE plpgsql;

-- 2. Atomic increment_quota_usage
CREATE OR REPLACE FUNCTION increment_quota_usage(
  p_quota_id UUID,
  p_tokens INTEGER
) RETURNS VOID AS $$
BEGIN
  UPDATE quotas SET current_usage = COALESCE(current_usage, 0) + p_tokens
  WHERE id = p_quota_id;
END;
$$ LANGUAGE plpgsql;

-- 3. Atomic increment_lifetime_tokens (upsert)
CREATE OR REPLACE FUNCTION increment_lifetime_tokens(
  p_api_key_name TEXT,
  p_tokens INTEGER
) RETURNS VOID AS $$
BEGIN
  INSERT INTO api_key_token_totals (api_key_name, total_tokens, total_requests, updated_at)
  VALUES (p_api_key_name, p_tokens, 1, NOW())
  ON CONFLICT (api_key_name)
  DO UPDATE SET
    total_tokens = api_key_token_totals.total_tokens + p_tokens,
    total_requests = api_key_token_totals.total_requests + 1,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- 4. Check quota limit (returns true if within limit)
CREATE OR REPLACE FUNCTION check_quota_limit(
  p_provider_id UUID,
  p_model TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_limit INTEGER;
  v_usage INTEGER;
BEGIN
  SELECT monthly_limit, current_usage INTO v_limit, v_usage
  FROM quotas
  WHERE provider_id = p_provider_id
    AND model = p_model
  LIMIT 1;

  IF v_limit IS NULL OR v_limit = 0 THEN
    RETURN TRUE; -- no limit
  END IF;

  RETURN v_usage < v_limit;
END;
$$ LANGUAGE plpgsql;

-- 5. Increment quota usage by provider + model
CREATE OR REPLACE FUNCTION increment_quota_usage_by_model(
  p_provider_id UUID,
  p_model TEXT,
  p_tokens INTEGER
) RETURNS VOID AS $$
BEGIN
  UPDATE quotas
  SET current_usage = current_usage + p_tokens
  WHERE provider_id = p_provider_id
    AND model = p_model;
END;
$$ LANGUAGE plpgsql;


-- ═══════════════════════════════════════════════════════════════════
-- DONE! Your database is ready.
-- ═══════════════════════════════════════════════════════════════════
-- On first login to the dashboard, Razoter will auto-create a default
-- admin user (username: "admin", password: "admin123").
-- Change this password immediately after first login!
-- ═══════════════════════════════════════════════════════════════════
