# 🦞 clawstack

> The complete OpenClaw Docker stack — batteries included.

**OpenClaw + Mission Control + PostgreSQL + Redis + Qdrant + Nginx**
— wired together, one command to run.

[![License: MIT](https://img.shields.io/badge/License-MIT-orange.svg)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/iolyte/clawstack?style=flat)](https://github.com/iolyte/clawstack/stargazers)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-Gateway-blue)](https://github.com/openclaw/openclaw)

---

## What's inside

| Service | Purpose |
|---|---|
| 🦞 **openclaw** | OpenClaw gateway + agent runtime (port 18789) |
| 🖥️ **mission-control** | Password-protected read-only control deck for stack health, persistence verification, and gateway diagnostics |
| 🗃️ **postgres** | Structured data — sessions, tasks, agent state |
| ⚡ **redis** | Pub/sub, caching, inter-agent messaging |
| 🔍 **qdrant** | Vector store for embeddings & semantic search |
| 🌐 **nginx** | Reverse proxy — routes to gateway & dashboard |

---

## Quickstart

### Prerequisites
- [Docker Desktop](https://docs.docker.com/desktop/mac/) (Mac)
- An [OpenRouter](https://openrouter.ai) API key (free tier available)

### Install

```bash
git clone https://github.com/iolyte/clawstack.git
cd clawstack
./scripts/clawstack install
```

### Configure

```bash
cp .env.example .env
# Edit .env — add your OPENROUTER_API_KEY at minimum
```

### Start

```bash
clawstack start
```

Open **http://localhost** — Mission Control is live 🎉

---

## clawstack CLI

```bash
clawstack install     # set up and add to PATH
clawstack start       # start all containers
clawstack stop        # stop all containers
clawstack restart     # restart all containers
clawstack status      # container health + gateway status
clawstack doctor      # inspect bind mounts + datastores
clawstack logs        # tail all logs
clawstack logs <svc>  # tail specific service logs
clawstack team        # bootstrap or repair the default AI agent team
clawstack update      # pull latest images
clawstack reset       # wipe bind-mounted data and start fresh
clawstack shell <svc> # open a shell in a container
```

---

## Mission Control features

- **Overview** — Apple-inspired diagnostics surface for stack health and persistence
- **Health** — live probes for gateway, Postgres, Redis, Qdrant, nginx, and Mission Control
- **Persistence** — direct visibility into bind-mounted storage on your Mac
- **Gateway snapshot** — live agent and session counts from OpenClaw
- **Setup issues** — clear remediation hints when a service or data root needs attention

---

## Architecture

```
                    ┌─────────────────────────────────────────┐
                    │            clawstack (Docker)            │
                    │                                         │
   Browser ─────► nginx:80 ──┬─► mission-control:4000        │
                              └─► openclaw:18789 (WS)         │
                                       │                      │
                              ┌────────┼────────┐             │
                           postgres  redis   qdrant           │
                    └─────────────────────────────────────────┘
```

All containers are on a shared `clawnet` bridge network.

---

## Configuration

All config lives in `.env`. See `.env.example` for all options.

| Variable | Required | Description |
|---|---|---|
| `OPENROUTER_API_KEY` | ✅ | Your OpenRouter API key |
| `OPENCLAW_GATEWAY_PASSWORD` | auto-generated | Shared password used by OpenClaw gateway auth and Mission Control's automatic gateway connection |
| `MC_ADMIN_PASSWORD` | auto-generated | Password for the Mission Control browser dashboard |
| `MC_SESSION_SECRET` | auto-generated | Session signing secret for Mission Control |
| `MC_SECURE_COOKIES` | optional | Set to `true` only when serving Mission Control over HTTPS |
| `POSTGRES_PASSWORD` | ✅ | Set a strong password |
| `ANTHROPIC_API_KEY` | optional | Direct Anthropic access |
| `OPENAI_API_KEY` | optional | Direct OpenAI access |

`clawstack start` now auto-generates `OPENCLAW_GATEWAY_PASSWORD`,
`MC_ADMIN_PASSWORD`, and `MC_SESSION_SECRET` if they are missing, prints the
generated passwords in the terminal, and bootstraps a default operator team
(`research`, `builder`, `ops`, `qa`) inside OpenClaw.

---

## Persistence

All service data now lives in bind-mounted folders under `.data/`, which makes it inspectable directly on your Mac and persistent across container restarts.

| Path | Contents |
|---|---|
| `.data/openclaw/config` | Gateway config, agent memory |
| `.data/openclaw/workspace` | Agent workspace files |
| `.data/postgres` | PostgreSQL data directory |
| `.data/redis` | Redis persistence files |
| `.data/qdrant` | Qdrant storage |

Mission Control Phase 1 stores its durable metadata in PostgreSQL under the `mission_control` schema.

---

## Contributing

PRs welcome! See [CONTRIBUTING.md](docs/CONTRIBUTING.md).

For release steps, see [RELEASING.md](docs/RELEASING.md).

```bash
git checkout -b feature/my-feature
git commit -m 'feat: add my feature'
git push origin feature/my-feature
```

---

## License

MIT — see [LICENSE](LICENSE)

---

Built with 🦞 by [iolyte](https://github.com/iolyte)
