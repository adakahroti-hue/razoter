# 🚀 Razoter

**API Proxy Router** — Merge multiple OpenAI-compatible endpoints into one with automatic rotation.

## Features

- **3 Rotation Modes**: Failover, Round-Robin, Priority
- **OpenAI-Compatible**: Standard Chat Completions API
- **Dashboard**: Manage providers, view logs & stats
- **Auto-Retry**: Automatic failover on errors (429/500/timeout)
- **Health Monitoring**: Track provider health status

## Quick Start

### 1. Install & Run

```bash
npm install
npm run dev
```

### 2. Set API Key

Create `.env.local`:

```env
RAZOTER_API_KEY=your-secret-key
NEXT_PUBLIC_RAZOTER_API_KEY=your-secret-key
```

### 3. Add Providers

Open `http://localhost:3000/dashboard` and add your API providers:

- **Base URL**: `https://api.openai.com/v1` (or any OpenAI-compatible)
- **API Key**: Your provider's API key
- **Model**: `gpt-4`, `claude-3-sonnet`, etc.
- **Priority**: Lower number = higher priority

### 4. Use the Proxy

```bash
# List models (includes Gabung/combo names)
curl https://your-host/api/v1/models \
  -H "Authorization: Bearer ***"

# Chat completions — for Gabung, set model = combo name
curl -X POST https://your-host/api/v1/chat/completions \
  -H "Authorization: Bearer ***" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "fast-mix",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

Gabung (combo) models created in the dashboard appear in `/api/v1/models` and are selected by sending their **name** as `model`.

## Rotation Modes

| Mode | Description |
|------|-------------|
| **Failover** | Use primary provider, auto-switch on error |
| **Round-Robin** | Distribute requests evenly |
| **Priority** | Use in priority order (lower = higher) |

## Deployment (Vercel)

```bash
npm i -g vercel
vercel --prod
```

Set environment variables in Vercel dashboard:
- `RAZOTER_API_KEY`
- `NEXT_PUBLIC_RAZOTER_API_KEY`

## Tech Stack

- Next.js 16 (App Router)
- Tailwind CSS
- TypeScript

## License

MIT
# Auto-deploy trigger
