import os
import sys
from supabase import create_client, Client

# Read credentials from environment or use defaults
url = os.environ.get("SUPABASE_URL", "https://eqgqmhgfgraspghjvdpt.supabase.co")
key = os.environ.get("SUPABASE_SERVICE_KEY", "")

if not key:
    print("Error: SUPABASE_SERVICE_KEY not set")
    sys.exit(1)

supabase: Client = create_client(url, key)

# Try to select from providers
try:
    result = supabase.table('providers').select('*').execute()
    print('Providers table exists!')
    print(f'Count: {len(result.data)}')
except Exception as e:
    print(f'Error: {e}')
