# Releasing clawstack

clawstack uses tag-based GitHub Releases.

## Normal release flow

1. Merge the release-ready pull request into `stable`.
2. Update version references if needed:
   - `scripts/clawstack`
   - `mission-control/package.json`
3. Run local validation:
   - `cd mission-control && npm run lint`
   - `cd mission-control && npm run typecheck`
   - `cd mission-control && npm run build`
   - `docker compose config -q`
4. Create an annotated tag:
   - `git tag -a v1.0.1 -m "Release v1.0.1"`
5. Push the tag:
   - `git push origin v1.0.1`
6. GitHub Actions runs the `Release` workflow and publishes a GitHub Release with generated notes.

## Prereleases

- Use a semver prerelease tag such as `v1.1.0-rc.1`.
- Tags containing a hyphen are automatically marked as prereleases by the workflow.

## Manual publish

- The `Release` workflow also supports `workflow_dispatch`.
- Use it when the tag already exists and you want GitHub to publish the release without pushing a new tag.

## Current release artifact scope

- GitHub Release notes are generated automatically from merged pull requests and commits.
- The workflow currently publishes the GitHub Release record only.
- Docker images are validated during release, but they are not yet pushed to a registry as part of this workflow.
