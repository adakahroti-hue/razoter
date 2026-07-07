-- Migration: Add ChatGPT Plus OAuth support to providers table
-- Run this in Supabase SQL Editor

-- Add auth_type column (default: api_key)
ALTER TABLE providers ADD COLUMN IF NOT EXISTS auth_type TEXT DEFAULT 'api_key';

-- Add ChatGPT Plus OAuth token columns
ALTER TABLE providers ADD COLUMN IF NOT EXISTS chatgpt_refresh_token TEXT;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS chatgpt_expires_at TIMESTAMP WITH TIME ZONE;

-- Add models and selected_models columns if missing (from earlier schema update)
ALTER TABLE providers ADD COLUMN IF NOT EXISTS models JSONB DEFAULT '[]'::jsonb;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS selected_models JSONB DEFAULT '[]'::jsonb;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS last_health_check TIMESTAMP WITH TIME ZONE;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS rate_limit_reset BIGINT;

-- Verify
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'providers'
ORDER BY ordinal_position;
