# agentStack — Architecture

## Overview

agentStack is an open-source AI team control plane.

- `mission-control` = UI/BFF
- `control-plane` = source of truth
- `orchestrator` = async execution
- `openclaw` = optional gateway adapter

## Runtime

```mermaid
flowchart LR
  browser["Browser"] --> nginx["nginx"]
  nginx --> mc["mission-control :4000"]
  mc --> cp["control-plane :4100"]
  cp --> pg["postgres :5432"]
  cp --> redis["redis :6379"]
  cp --> qdrant["qdrant :6333"]
  orch["orchestrator :4200"] --> redis
  orch --> cp
  openclaw["openclaw :18789 (optional)"] --> cp
```

## Responsibilities

- `mission-control`
  - browser auth/session
  - product UI
  - thin proxy to control-plane
  - ops visibility
- `control-plane`
  - workspaces
  - projects
  - agents
  - tasks
  - messages
  - runs
  - workspace events
- `orchestrator`
  - Redis Streams consumers
  - LangGraph execution foundation
  - future approval/retry/routing flows
- `postgres`
  - source of truth
- `redis`
  - event bus and queue
- `qdrant`
  - semantic retrieval index
- `openclaw`
  - optional chat/voice gateway integration

## Defaults

- Default stack does **not** require `openclaw`
- All containers share `agentstack_net`
- Only `nginx` is intended as the public entrypoint
