import os
from supabase import create_client, Client

url = "https://eqgqmhgfgraspghjvdpt.supabase.co"
key = os.environ.get("SUPABASE_SERVICE_KEY")

supabase: Client = create_client(url, key)

# Try to select from providers
try:
    result = supabase.table('providers').select('*').execute()
    print('Providers table exists!')
    print(f'Count: {len(result.data)}')
except Exception as e:
    print(f'Error: {e}')
