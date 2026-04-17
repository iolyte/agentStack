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
| 🖥️ **mission-control** | ClawStack workspace and operations surface for setup, agent chat, task management, persistence verification, and gateway diagnostics |
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

- **Workspace bootstrap** — define a goal, choose departments, and let ClawStack create the first team and backlog
- **Agent management** — inspect the live roster, add specialists, and keep the workspace scoped by role
- **Task execution board** — assign work, update states, and keep the next deliverables visible
- **Agent chat** — send instructions to one agent at a time with persisted message history
- **Ops diagnostics** — keep the original stack health, persistence, and gateway visibility in one operator tab

---

## Desktop Beta

The macOS launcher now lives in [`desktop/`](./desktop). It gives ClawStack a native
launcher shell that can:

- check Docker Desktop readiness
- prepare a packaged runtime folder under app local data
- start, stop, and restart the local stack
- open Mission Control in the default browser
- unlock a local stronghold vault for Cloudflare credentials
- create a Cloudflare Tunnel for a beta hostname
- guide Cloudflare Access setup before marking the remote URL ready

### Run the desktop launcher in development

```bash
cd desktop
npm install
npm run desktop:dev
```

The desktop app prefers **repo mode** while you are developing in this checkout,
which means it calls the existing `scripts/clawstack` helper and uses the repo's
`.env` file and Docker Compose stack. Packaged runtime mode uses the app-local
runtime bundle and the published `ghcr.io/iolyte/clawstack-mission-control`
image line.

If you want to test the remote access flow locally with the official Cloudflare
binary instead of the placeholder sidecar, run:

```bash
cd desktop
npm run desktop:prepare-sidecars
```

For local validation, `npm run desktop:build` produces the signed `.app` bundle.
The signed + notarized `.dmg` path is reserved for the release workflow via
`npm run desktop:build:dmg`.

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
| `AUTH_JWT_SECRET` | optional | Dedicated JWT signing secret for GitHub OAuth sessions |
| `APP_BASE_URL` | optional | Public base URL used for GitHub OAuth callbacks |
| `GITHUB_CLIENT_ID` | optional | Enables GitHub OAuth sign-in when paired with the client secret |
| `GITHUB_CLIENT_SECRET` | optional | Enables GitHub OAuth sign-in when paired with the client ID |
| `MC_SECURE_COOKIES` | optional | Set to `true` only when serving Mission Control over HTTPS |
| `POSTGRES_PASSWORD` | ✅ | Set a strong password |
| `ANTHROPIC_API_KEY` | optional | Direct Anthropic access |
| `OPENAI_API_KEY` | optional | Direct OpenAI access |

`clawstack start` now auto-generates `OPENCLAW_GATEWAY_PASSWORD`,
`MC_ADMIN_PASSWORD`, and `MC_SESSION_SECRET` if they are missing, prints the
generated passwords in the terminal, and bootstraps a default operator team
(`research`, `builder`, `ops`, `qa`) inside OpenClaw.

If GitHub OAuth variables are not configured, Mission Control stays fully local
with the generated password flow.

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

Mission Control stores operational metadata in PostgreSQL under the `mission_control`
schema and workspace data under the `amp` schema.

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
