# 🚀 Razoter

**API Proxy Router** — Merge multiple OpenAI-compatible endpoints into one with automatic rotation.

## Features

- **3 Rotation Modes**: Failover, Round-Robin, Priority
- **OpenAI-Compatible**: Standard Chat Completions API
- **Dashboard**: Manage providers, view logs & stats
- **Auto-Retry**: Automatic failover on errors (429/500/timeout)
- **Health Monitoring**: Track provider health status
- **Multi API Key**: Multiple keys per provider with strategy (random/failover/round-robin)
- **Quota System**: Per-model and per-key monthly limits
- **Gabung (Combo)**: Merge multiple models into one virtual model
- **ChatGPT Plus Auth**: OAuth support for ChatGPT providers

---

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- A [Supabase](https://supabase.com) account (free tier is fine)

### 1. Clone & Install

```bash
git clone https://github.com/adakahroti-hue/razoter.git
cd razoter
npm install
```

### 2. Set Up Database (Supabase)

Razoter uses [Supabase](https://supabase.com) (artinya: layanan database online berbasis PostgreSQL) as its database. You need to create a free Supabase project and run the schema.

#### Step 2a — Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign up / log in.
2. Click **New Project**. Give it a name (e.g. `razoter`).
3. Set a database password — save it somewhere safe.
4. Choose a region close to your users.
5. Wait ~2 minutes for the project to provision.

#### Step 2b — Run the Database Schema

Once your project is ready:

1. Open your Supabase project dashboard.
2. Go to **SQL Editor** (left sidebar → click `SQL Editor`).
3. Click **New query**.
4. Copy the entire contents of [`supabase/schema.sql`](./supabase/schema.sql) from this repo, paste it into the SQL Editor, and click **Run**. This creates the core tables: `providers`, `request_logs`, `app_config`, and enables Row Level Security.

#### Step 2c — Run Migration Files

After the schema, run each migration file **in order** (001 → 009). Each file adds or modifies columns/tables. For each file:

1. Open a **New query** in Supabase SQL Editor.
2. Copy the contents of the file, paste, and **Run**.

| Order | File | What it does |
|-------|------|-------------|
| 1 | `supabase/migrations/001_users.sql` | Creates `users` table (for dashboard login) with RLS |
| 2 | `supabase/migrations/002_chatgpt_plus_auth.sql` | Adds ChatGPT Plus OAuth columns to providers |
| 3 | `supabase/migrations/003_quota_per_model.sql` | Adds model column to quotas table |
| 4 | `supabase/migrations/004_multi_api_key.sql` | Adds multi API key support (JSONB array per provider) |
| 5 | `supabase/migrations/005_quota_per_api_key.sql` | Adds per-API-key quota tracking |
| 6 | `supabase/migrations/006_log_api_key_name.sql` | Adds API key name to request logs |
| 7 | `supabase/migrations/007_api_key_strategy.sql` | Adds API key selection strategy column |
| 8 | `supabase/migrations/008_archive_providers.sql` | Adds archive (soft-delete) column to providers |
| 9 | `supabase/migrations/009_api_key_token_totals.sql` | Creates lifetime token totals table per API key |

> **Tip:** You can also combine all migrations into one query and run them all at once — they're designed to be idempotent (artinya: aman dijalankan berulang, tidak akan error kalau tabel/kolom sudah ada karena pakai `IF NOT EXISTS`).

On first login to the dashboard, Razoter will **auto-create a default admin user** (username: `admin`, password: `admin123`). **Change this password immediately after first login.**

#### Step 2d — Get Your Supabase Credentials

From your Supabase project dashboard:

1. Go to **Project Settings** (gear icon, bottom left) → **API**.
2. Copy these two values:
   - **Project URL** — looks like `https://xxxxxxxxxxxx.supabase.co`
   - **service_role secret** — a long string starting with `eyJ...` (this is the **secret** key, NOT the `anon` public key)

> ⚠️ **Important:** Use the **service_role** key, not the `anon` public key. The service_role key bypasses RLS and allows Razoter to read/write data. Never expose this key in client-side code or public repos.

#### Step 2e — Get Your JWT Secret

Razoter also needs a `JWT_SECRET` for signing auth tokens. You can:

- Use the **JWT Setting** from Supabase: Project Settings → API → JWT Settings → copy the `JWT Secret`.
- Or generate your own: `openssl rand -hex 32` (run in terminal, copy the output).

### 3. Set Up Environment Variables

Create a `.env.local` file in the project root:

```env
# Supabase
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIs...your-service-role-key...

# Auth
JWT_SECRET=your-jwt-secret-here

# API Keys (used by the proxy endpoint)
RAZOTER_API_KEY=your-secret-key
NEXT_PUBLIC_RAZOTER_API_KEY=your-secret-key

# Optional: Rate limiting (defaults shown)
# RATE_LIMIT_MAX=100
# RATE_LIMIT_WINDOW_MS=60000
```

Set `RAZOTER_API_KEY` to any secret string you want — this is the key clients will use to call your proxy API (in the `Authorization: Bearer <your-key>` header).

### 4. Run

```bash
npm run dev
```

Open `http://localhost:3000/dashboard` and log in with:

- **Username**: `admin`
- **Password**: `admin123`

> ⚠️ Change the admin password after first login!

### 5. Add Providers

In the dashboard, add your API providers:

- **Base URL**: `https://api.openai.com/v1` (or any OpenAI-compatible endpoint)
- **API Key**: Your provider's API key
- **Models**: Click "Test" to auto-discover available models
- **Priority**: Lower number = higher priority

### 6. Use the Proxy

#### List available models

```bash
curl https://your-domain/api/v1/models \
  -H "Authorization: Bearer your-razoter-api-key"
```

#### Chat completions

```bash
curl -X POST https://your-domain/api/v1/chat/completions \
  -H "Authorization: Bearer your-razoter-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

#### Gabung (combo) models

Combo models are virtual models that merge multiple providers into one. Create them in the dashboard's **Gabung** tab, then use the combo name as the `model` field:

```bash
curl -X POST https://your-domain/api/v1/chat/completions \
  -H "Authorization: Bearer your-razoter-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "fast-mix",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

> 💡 The **Dokumentasi** tab in the dashboard auto-detects your domain and shows the correct Base URL + ready-to-copy curl examples. No need to manually figure out the URL — just open the tab and copy.

---

## Database Schema Overview

Razoter uses the following Supabase tables:

| Table | Purpose |
|-------|---------|
| `users` | Dashboard login accounts (username + bcrypt password hash) |
| `providers` | AI provider configs (name, base URL, API keys, models, priority, health stats) |
| `combos` | Gabung / combo model definitions (virtual models merging multiple providers) |
| `request_logs` | API request history (provider, model, status, latency, tokens, errors) |
| `quotas` | Monthly usage limits per provider/model/API-key |
| `api_key_token_totals` | Lifetime token usage per API key (survives log cleanup) |
| `app_config` | Global app settings (rotation mode, timeout, max retries) |

All tables use **Row Level Security (RLS)** with a policy that allows the **service_role** key full access. This means:
- Data is not accessible with the `anon` (public) Supabase key.
- Only Razoter's backend (which uses the service_role key) can read/write.

---

## Rotation Modes

| Mode | Description |
|------|-------------|
| **Failover** | Use primary provider, auto-switch on error |
| **Round-Robin** | Distribute requests evenly across providers |
| **Priority** | Use in priority order (lower number = higher priority) |

---

## Deployment (Vercel)

```bash
npm i -g vercel
vercel --prod
```

Set all environment variables in the Vercel dashboard (Project → Settings → Environment Variables):

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | ✅ | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | ✅ | Supabase service_role secret key |
| `JWT_SECRET` | ✅ | Secret for signing auth JWT tokens |
| `RAZOTER_API_KEY` | ✅ | Key clients use to call the proxy |
| `NEXT_PUBLIC_RAZOTER_API_KEY` | ✅ | Same as above (needed client-side) |
| `RATE_LIMIT_MAX` | Optional | Max requests per window (default: 100) |
| `RATE_LIMIT_WINDOW_MS` | Optional | Rate limit window in ms (default: 60000) |

> 💡 The Base URL shown in the dashboard's **Dokumentasi** tab is dynamic — it auto-detects whatever domain you deploy to. No configuration needed.

---

## Tech Stack

- Next.js 16 (App Router)
- Tailwind CSS
- TypeScript
- Supabase (PostgreSQL)
- bcryptjs (password hashing)
- jose (JWT)

## License

MIT
