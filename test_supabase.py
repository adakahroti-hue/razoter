import json
import httpx

SUPABASE_URL = "https://eqgqmhgfgraspghjvdpt.supabase.co"
SERVICE_KEY = "eyJhbG...kxpc"

# Check if providers table exists
response = httpx.get(
    f"{SUPABASE_URL}/rest/v1/providers",
    headers={
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}"
    },
    params={"select": "count"}
)

print(f"Status: {response.status_code}")
print(f"Response: {response.text[:200]}")

# Check tables
response2 = httpx.get(
    f"{SUPABASE_URL}/rest/v1/",
    headers={
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}"
    }
)

print(f"\nTables: {response2.text[:500]}")
