# Releasing clawstack

ClawStack beta releases are tag-based GitHub Releases built from `stable` and
published as prereleases from semver beta tags such as `v0.1.0-beta.1`.

## Beta flow

1. Merge the release-ready work into `stable`.
2. Keep the version line aligned before tagging:
   - `scripts/clawstack`
   - `mission-control/package.json`
   - `desktop/package.json`
   - `desktop/src-tauri/Cargo.toml`
   - `desktop/runtime-template/.env.template`
3. Run local validation:
   - `cd mission-control && npm run lint`
   - `cd mission-control && npm run typecheck`
   - `cd mission-control && npm run test`
   - `cd mission-control && npm run build`
   - `cd desktop && npm ci`
   - `cd desktop && npm run build`
   - `cd desktop && npm run desktop:check`
   - `cd desktop && npm run desktop:build`
   - `docker compose config -q`
4. Create an annotated beta tag:
   - `git tag -a v0.1.0-beta.1 -m "Release v0.1.0-beta.1"`
5. Push the tag:
   - `git push origin v0.1.0-beta.1`
6. GitHub Actions:
   - validates Mission Control and Docker Compose
   - publishes `ghcr.io/iolyte/clawstack-mission-control:<version>`
   - downloads the official `cloudflared` sidecars for macOS
   - builds the signed + notarized `.dmg`
   - publishes the GitHub prerelease with generated notes and the `.dmg` attached

## Required GitHub secrets

The beta release workflow expects these repository secrets:

- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_KEYCHAIN_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`

`APPLE_CERTIFICATE` should be the base64-encoded `.p12` signing certificate.

## Manual publish

- The `Release` workflow also supports `workflow_dispatch`.
- Use it when the tag already exists and you want GitHub to publish the release without pushing a new tag.

## Artifact scope

- GitHub Release notes are generated automatically from merged pull requests and commits.
- Beta releases publish the Mission Control image to GHCR.
- Beta releases attach the notarized macOS `.dmg` to the GitHub release.
