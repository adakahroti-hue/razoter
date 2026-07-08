-- Migration 004: Multi API Key per Provider
-- Adds api_keys column (JSONB array) to support multiple keys per provider

-- Add api_keys column (JSONB array of {name, key, enabled})
ALTER TABLE providers ADD COLUMN IF NOT EXISTS api_keys JSONB DEFAULT '[]'::jsonb;

-- Migrate existing single api_key into api_keys array if not already done
UPDATE providers
SET api_keys = jsonb_build_array(
  jsonb_build_object(
    'name', 'Default',
    'key', api_key,
    'enabled', true
  )
)
WHERE api_keys = '[]'::jsonb OR api_keys IS NULL;
