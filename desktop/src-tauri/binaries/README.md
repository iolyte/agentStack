# Bundled cloudflared sidecars

These files are placeholder executables so the desktop app can compile locally
before the release pipeline downloads the official `cloudflared` binaries.

Release builds replace them with the latest Cloudflare binaries for:

- `aarch64-apple-darwin`
- `x86_64-apple-darwin`

Do not ship the placeholder scripts in a public beta build.
