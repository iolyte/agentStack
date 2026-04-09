# clawstack — Architecture

## Overview

clawstack is an opinionated Docker stack for running OpenClaw with a full supporting
infrastructure and a purpose-built Mission Control dashboard.

## Network

All containers run on a single Docker bridge network (`clawnet`). Services
communicate by container name (e.g. `postgres:5432`, `redis:6379`).

```
clawnet (bridge)
├── openclaw        :18789
├── mission-control :4000
├── postgres        :5432
├── redis           :6379
├── qdrant          :6333, :6334
└── nginx           :80
```

## Container responsibilities

### openclaw
The OpenClaw gateway — WebSocket server that connects to AI providers via
OpenRouter, manages agent sessions, channels, and tool execution. Config
and workspace are persisted to bind-mounted folders in `.data/`.

### mission-control
Next.js dashboard that reads live agent state from OpenClaw, authenticates to
the gateway with the shared `OPENCLAW_GATEWAY_PASSWORD` env var, and persists
dashboard-specific metadata in PostgreSQL under the `mission_control` schema. Serves on port 4000,
proxied through nginx.

Mission Control stores:
- Schema version and last successful boot metadata
- Read-only stack health, persistence, and gateway diagnostics

Mission Control access is protected with a password-backed session cookie when
`MC_ADMIN_PASSWORD` is configured.

### postgres
PostgreSQL 16. Stores structured data: agents, tasks, sessions, events.
Schema initialised from `postgres/init.sql` on first boot.

### redis
Redis 7 with AOF persistence, capped at 256MB. Used for:
- Pub/sub between openclaw and mission-control
- Session caching
- Inter-agent messaging queue

### qdrant
Vector database. Stores embeddings for semantic search and RAG workflows.
REST API on :6333, gRPC on :6334.

### nginx
Reverse proxy. Routes:
- `/` → mission-control:4000
- `/gateway/` → openclaw:18789 (WebSocket upgrade)

## Data flow

```
User → nginx:80
         ├── / → mission-control:4000
         │         ├── HTTP RPC → openclaw:18789 (Bearer OPENCLAW_GATEWAY_PASSWORD)
         │         ├── PostgreSQL → mission_control schema
         │         ├── Read-only `.data` bind mount → persistence inspection
         │         ├── TCP health probe → postgres:5432
         │         ├── Redis ping → redis:6379
         │         └── HTTP health probe → qdrant:6333
         └── /gateway/ → openclaw:18789
```

## Bind mounts

| Host path                   | Mount                           | Purpose                  |
|----------------------------|---------------------------------|--------------------------|
| `.data/openclaw/config`    | /home/node/.openclaw            | Gateway config + memory  |
| `.data/openclaw/workspace` | /home/node/.openclaw/workspace  | Agent workspace files    |
| `.data/postgres`           | /var/lib/postgresql/data        | Database                 |
| `.data/redis`              | /data                           | Redis persistence        |
| `.data/qdrant`             | /qdrant/storage                 | Vector embeddings        |

## AI Provider priority

OpenClaw selects the provider in this order:
1. Anthropic (if `ANTHROPIC_API_KEY` set)
2. OpenAI (if `OPENAI_API_KEY` set)
3. OpenRouter (if `OPENROUTER_API_KEY` set) ← recommended for clawstack

OpenRouter gives access to 200+ models (Claude, GPT-4o, Gemini, Llama, etc.)
with a single API key and no GPU required.

## Embeddings

For RAG / semantic search, use OpenRouter's embedding endpoints or point
OpenClaw at any OpenAI-compatible embedding API. Qdrant stores the resulting
vectors regardless of source.

## Security notes

- Never commit `.env`
- Set `MC_ADMIN_PASSWORD` in production before exposing Mission Control publicly
- Set `OPENCLAW_GATEWAY_PASSWORD` in production; Mission Control uses the same value for gateway RPC
- Redis and Qdrant are not exposed on host ports by default
