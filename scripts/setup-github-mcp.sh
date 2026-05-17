#!/usr/bin/env bash
# One-time setup for the GitHub MCP server (github/github-mcp-server).
# Downloads the latest pre-built single binary for the current platform from
# the project's GitHub Releases and installs it at ~/.openswarm/bin/.
# OpenSwarm's GitHub tool tile spawns that binary directly (stdio transport).
# Re-running this is safe and is how you upgrade to a newer release.

set -euo pipefail

DEST_DIR="$HOME/.openswarm/bin"
DEST="$DEST_DIR/github-mcp-server"

TAG="$(curl -fsSL https://api.github.com/repos/github/github-mcp-server/releases/latest \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['tag_name'])")"

OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS-$ARCH" in
  Darwin-arm64)            ASSET="github-mcp-server_Darwin_arm64.tar.gz" ;;
  Darwin-x86_64)           ASSET="github-mcp-server_Darwin_x86_64.tar.gz" ;;
  Linux-x86_64)            ASSET="github-mcp-server_Linux_x86_64.tar.gz" ;;
  Linux-aarch64|Linux-arm64) ASSET="github-mcp-server_Linux_arm64.tar.gz" ;;
  *) echo "error: unsupported platform $OS-$ARCH" >&2; exit 1 ;;
esac

URL="https://github.com/github/github-mcp-server/releases/download/$TAG/$ASSET"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading github-mcp-server $TAG ($OS-$ARCH)..."
curl -fSL "$URL" -o "$TMP/$ASSET"
tar -xzf "$TMP/$ASSET" -C "$TMP"

mkdir -p "$DEST_DIR"
mv -f "$TMP/github-mcp-server" "$DEST"
chmod +x "$DEST"

echo "Installed: $DEST"
"$DEST" --version 2>/dev/null || true
