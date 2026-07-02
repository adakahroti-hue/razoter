import httpx
import json

SUPABASE_URL = "https://eqgqmhgfgraspghjvdpt.supabase.co"
SERVICE_KEY = "eyJhbG...kxpc"

# Test connection
response = httpx.get(
    f"{SUPABASE_URL}/rest/v1/",
    headers={
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}"
    }
)

print(f"Status: {response.status_code}")
print(f"Response: {response.text[:500]}")
