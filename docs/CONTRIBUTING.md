# Contributing to agentStack

## Local dev

```bash
git clone https://github.com/iolyte/agentStack.git
cd agentStack
cp .env.example .env
./scripts/clawstack start
```

## App dev

```bash
cd apps/mission-control && npm install && npm run dev
cd apps/control-plane && npm install && npm run dev
cd apps/orchestrator && npm install && npm run dev
```

## Validate before PR

```bash
cd apps/mission-control && npm run lint && npm run typecheck && npm run test && npm run build
cd apps/control-plane && npm run build
cd apps/orchestrator && npm run build
docker compose config -q
docker compose --profile gateway config -q
```

## Current structure

- `apps/mission-control` — Next.js UI/BFF
- `apps/control-plane` — source of truth backend
- `apps/orchestrator` — LangGraph + Redis Streams worker
- `packages/` — shared foundations
- `desktop/` — frozen for now
