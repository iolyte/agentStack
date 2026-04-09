# Contributing to clawstack

Thanks for your interest! clawstack is open source and PRs are welcome.

## Getting started

```bash
git clone https://github.com/iolyte/clawstack.git
cd clawstack
cp .env.example .env
# Fill in your API keys
```

## Development

### Run the full stack
```bash
./scripts/clawstack start
```

The first start auto-generates both the OpenClaw gateway password and the
Mission Control password if they are not already present in `.env`, and
bootstraps the default OpenClaw agent team.

### Run Mission Control in dev mode (hot reload)
```bash
cd mission-control
npm install
npm run dev
npm run lint
npm run typecheck
# Open http://localhost:4000
```

### Run only infrastructure (no Mission Control build needed)
```bash
docker compose up -d postgres redis qdrant openclaw nginx
```

## Project structure

```
clawstack/
├── docker-compose.yml       # Main compose file
├── .env.example             # Environment template
├── scripts/
│   └── clawstack            # CLI entrypoint (bash)
├── mission-control/         # Next.js dashboard
│   ├── src/app/             # App router pages
│   ├── src/components/      # Reusable components
│   ├── src/lib/             # OpenClaw client, DB, utils
│   └── Dockerfile
├── nginx/
│   └── nginx.conf
├── postgres/
│   └── init.sql
└── docs/
    ├── ARCHITECTURE.md
    └── CONTRIBUTING.md
```

## What to contribute

- 🐛 Bug fixes
- ✨ New Mission Control features (Phase 2 safe writes, richer diagnostics, gateway operations)
- 📖 Documentation improvements
- 🐳 Docker / infra improvements
- 🌐 New nginx configs (TLS, Tailscale)

## PR guidelines

- Keep PRs focused — one feature or fix per PR
- Add a clear description of what changed and why
- Test locally with `clawstack start` before opening PR
- Use `clawstack doctor` when validating persistence and datastore wiring
- Run `npm run lint`, `npm run typecheck`, and `npm run build` in `mission-control`
- Follow existing code style

## Issues

Found a bug? Open an issue with:
- Your OS and Docker version
- The output of `clawstack status`
- Steps to reproduce
