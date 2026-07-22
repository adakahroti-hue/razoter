-- Migration 009: Lifetime token totals per API key (independent of request_logs)
-- These totals do NOT get wiped when old logs are cleaned up.

CREATE TABLE IF NOT EXISTS api_key_token_totals (
  api_key_name TEXT PRIMARY KEY,
  total_tokens BIGINT NOT NULL DEFAULT 0,
  total_requests INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE api_key_token_totals ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'api_key_token_totals'
      AND policyname = 'Allow all for service role'
  ) THEN
    CREATE POLICY "Allow all for service role"
      ON api_key_token_totals
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_api_key_token_totals_tokens
  ON api_key_token_totals(total_tokens DESC);
