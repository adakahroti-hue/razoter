-- Migration 008: Archive providers (soft-delete / hide)
-- Adds archived column so problematic providers can be hidden without losing data.

ALTER TABLE providers ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false;

-- Index for filtering
CREATE INDEX IF NOT EXISTS idx_providers_archived ON providers(archived);
