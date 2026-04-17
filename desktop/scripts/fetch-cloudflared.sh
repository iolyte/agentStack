#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$ROOT_DIR/src-tauri/binaries"

mkdir -p "$BIN_DIR"

fetch_sidecar() {
  local target="$1"
  local url="$2"
  local tmp_dir
  tmp_dir="$(mktemp -d)"

  curl -fsSL "$url" -o "$tmp_dir/cloudflared.tgz"
  tar -xzf "$tmp_dir/cloudflared.tgz" -C "$tmp_dir"
  mv "$tmp_dir/cloudflared" "$BIN_DIR/cloudflared-$target"
  chmod +x "$BIN_DIR/cloudflared-$target"
  rm -rf "$tmp_dir"
}

fetch_sidecar "aarch64-apple-darwin" "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz"
fetch_sidecar "x86_64-apple-darwin" "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz"

echo "Prepared bundled cloudflared sidecars in $BIN_DIR"
