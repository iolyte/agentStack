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
| 🖥️ **mission-control** | Operations dashboard — agents, tasks, costs, chat, stack health |
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
clawstack logs        # tail all logs
clawstack logs <svc>  # tail specific service logs
clawstack update      # pull latest images
clawstack reset       # wipe volumes and start fresh
clawstack shell <svc> # open a shell in a container
```

---

## Mission Control features

- **Overview** — live stats, spend charts, token usage, event feed
- **Agents** — agent roster, model, status, token usage, cost per agent
- **Tasks** — Kanban board (Planning → Done), dispatch to agents
- **Chat** — talk to any agent directly in the browser
- **Costs** — per-agent spend breakdown, weekly/monthly trends
- **Stack** — health of every container in real time

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
| `OPENCLAW_GATEWAY_TOKEN` | ✅ | From `~/.openclaw/openclaw.json` |
| `POSTGRES_PASSWORD` | ✅ | Set a strong password |
| `ANTHROPIC_API_KEY` | optional | Direct Anthropic access |
| `OPENAI_API_KEY` | optional | Direct OpenAI access |
| `MC_API_TOKEN` | optional | Secure the Mission Control API |

---

## Volumes

| Volume | Contents |
|---|---|
| `openclaw-config` | Gateway config, agent memory |
| `openclaw-workspace` | Agent workspace files |
| `postgres-data` | Database |
| `redis-data` | Cache / pub-sub |
| `qdrant-data` | Vector embeddings |
| `mission-control-data` | Dashboard SQLite DB |

---

## Contributing

PRs welcome! See [CONTRIBUTING.md](docs/CONTRIBUTING.md).

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
