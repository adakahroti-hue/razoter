-- Migration 006: Add api_key_name to request_logs
-- So we can track which API key made each request

ALTER TABLE request_logs ADD COLUMN IF NOT EXISTS api_key_name TEXT DEFAULT '';
