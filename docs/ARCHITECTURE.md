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
and workspace are persisted to named volumes.

### mission-control
Next.js dashboard that connects to OpenClaw via WebSocket and to Postgres/Redis/
Qdrant for infrastructure health. Serves on port 4000, proxied through nginx.

Features pulled from community best-of-breed:
- Kanban task board (crshdn/mission-control)
- Gateway health + system metrics (robsannaa/openclaw-mission-control)
- Cost tracking per agent (carlosazaustre/tenacitOS)
- Token usage charts (builderz-labs/mission-control)
- Stack service health (homelab-ai-stack)
- Agent chat in browser (robsannaa/openclaw-mission-control)
- Live event feed (manish-raana/openclaw-mission-control)

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
         │         ├── WS → openclaw:18789
         │         ├── SQL → postgres:5432
         │         ├── cache → redis:6379
         │         └── vectors → qdrant:6333
         └── /gateway/ → openclaw:18789
```

## Volumes

| Volume                 | Mount                           | Purpose                  |
|------------------------|---------------------------------|--------------------------|
| openclaw-config        | /home/node/.openclaw            | Gateway config + memory  |
| openclaw-workspace     | /home/node/.openclaw/workspace  | Agent workspace files    |
| postgres-data          | /var/lib/postgresql/data        | Database                 |
| redis-data             | /data                           | Redis persistence        |
| qdrant-data            | /qdrant/storage                 | Vector embeddings        |
| mission-control-data   | /app/data                       | Dashboard SQLite         |

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
- Set `MC_API_TOKEN` in production to protect the Mission Control API
- OpenClaw gateway token is stored in the `openclaw-config` volume
- Redis and Qdrant are not exposed on host ports by default
