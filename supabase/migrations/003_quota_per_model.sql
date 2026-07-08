-- Migration 003: Add model column to quotas table
-- Run this in Supabase SQL Editor to update the quotas table

ALTER TABLE quotas ADD COLUMN IF NOT EXISTS model TEXT DEFAULT '';

-- Update existing quotas to have empty model (all models)
UPDATE quotas SET model = '' WHERE model IS NULL;

-- Update the incrementQuotaUsage function to match by provider_id and model
CREATE OR REPLACE FUNCTION increment_quota_usage(p_provider_id UUID, p_model TEXT, p_tokens INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE quotas
  SET current_usage = current_usage + p_tokens
  WHERE provider_id = p_provider_id
    AND model = p_model;
END;
$$ LANGUAGE plpgsql;

-- Update the checkQuotaLimit function to match by provider_id and model
CREATE OR REPLACE FUNCTION check_quota_limit(p_provider_id UUID, p_model TEXT)
RETURNS BOOLEAN AS $$
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

-- Add unique constraint to prevent duplicate quotas per provider+model
-- First remove any duplicates that might exist
DELETE FROM quotas a USING quotas b
WHERE a.id > b.id
  AND a.provider_id = b.provider_id
  AND a.model = b.model;

-- Then add the unique constraint
ALTER TABLE quotas ADD CONSTRAINT quotas_provider_model_unique UNIQUE (provider_id, model);
