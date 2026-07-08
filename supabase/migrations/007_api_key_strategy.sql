-- Migration: 007_api_key_strategy.sql
-- Add api_key_strategy column to providers table
-- Values: 'random' (default), 'failover-priority', 'round-robin'

ALTER TABLE providers ADD COLUMN IF NOT EXISTS api_key_strategy TEXT DEFAULT 'random';

-- Update existing providers to have 'random' as default
UPDATE providers SET api_key_strategy = 'random' WHERE api_key_strategy IS NULL;
