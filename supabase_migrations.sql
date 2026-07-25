-- Razoter Migration: Atomic RPC functions + indexes
-- Run this in Supabase Dashboard > SQL Editor
-- Date: 2026-07-24

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

-- 4. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_quotas_provider_id ON quotas(provider_id);
CREATE INDEX IF NOT EXISTS idx_combos_name_enabled ON combos(name) WHERE enabled = true;

-- 5. Unique constraint fix for quotas (include api_key_name)
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
