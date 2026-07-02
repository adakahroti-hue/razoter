import os
from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables from .env file
load_dotenv('/tmp/razoter/.env')

url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_KEY")

print(f"URL: {url}")
print(f"Key: {key[:20]}..." if key else "Key: None")

supabase: Client = create_client(url, key)

# Try to select from providers
try:
    result = supabase.table('providers').select('*').execute()
    print('Providers table exists!')
    print(f'Count: {len(result.data)}')
except Exception as e:
    print(f'Error: {e}')
