#!/usr/bin/env bash
# Installs the flow-mcp Native Messaging host manifest for Chrome on macOS / Linux.
#
# Usage:
#   ./install.sh <extension-id>

set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <chrome-extension-id>" >&2
  exit 1
fi
EXT_ID="$1"

HERE="$(cd "$(dirname "$0")" && pwd)"
HOST_JS="$HERE/host.js"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"

if [ -z "$NODE_BIN" ]; then
  echo "node not found in PATH; set NODE_BIN=/path/to/node and re-run" >&2
  exit 1
fi

LAUNCHER="$HERE/flow-mcp-host.sh"
cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
exec "$NODE_BIN" "$HOST_JS" "\$@"
EOF
chmod +x "$LAUNCHER"

MANIFEST="$HERE/com.flow_mcp.host.json"
cat > "$MANIFEST" <<EOF
{
  "name": "com.flow_mcp.host",
  "description": "flow-mcp Native Messaging host",
  "path": "$LAUNCHER",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
EOF

case "$(uname -s)" in
  Darwin)
    DEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
    ;;
  Linux)
    DEST_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
    ;;
  *)
    echo "unsupported OS $(uname -s)" >&2
    exit 1
    ;;
esac

mkdir -p "$DEST_DIR"
cp "$MANIFEST" "$DEST_DIR/com.flow_mcp.host.json"

echo "Installed Native Messaging host:"
echo "  manifest : $DEST_DIR/com.flow_mcp.host.json"
echo "  launcher : $LAUNCHER"
echo "  ext id   : $EXT_ID"
echo "Restart Chrome (or reload the extension) to pick up changes."
