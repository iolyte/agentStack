# Releasing agentStack

Current release flow is image-first.

## Validate

```bash
cd apps/mission-control && npm run lint && npm run typecheck && npm run test && npm run build
cd apps/control-plane && npm run build
cd apps/orchestrator && npm run build
docker compose config -q
```

## Tag

```bash
git tag -a v0.1.0-beta.1 -m "Release v0.1.0-beta.1"
git push origin v0.1.0-beta.1
```

## GitHub Actions publishes

- `ghcr.io/iolyte/agentstack-mission-control:<version>`
- `ghcr.io/iolyte/agentstack-control-plane:<version>`
- `ghcr.io/iolyte/agentstack-orchestrator:<version>`

Desktop packaging is paused until the core architecture split is complete.
