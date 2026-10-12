#!/bin/sh
# Build MNAgentBridgeReceiver.app, install it to ~/Applications and register its URL scheme.
# Usage: receiver/build.sh [install-dir]
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
VERSION=$(node -p "require('$HERE/../package.json').version" 2>/dev/null || echo 0.0.0)
DEST_DIR=${1:-"$HOME/Applications"}
APP="$DEST_DIR/MNAgentBridgeReceiver.app"
BUILD=$(mktemp -d)
trap 'rm -rf "$BUILD"' EXIT

swiftc -O -o "$BUILD/MNAgentBridgeReceiver" "$HERE/main.swift"

mkdir -p "$BUILD/MNAgentBridgeReceiver.app/Contents/MacOS"
cp "$BUILD/MNAgentBridgeReceiver" "$BUILD/MNAgentBridgeReceiver.app/Contents/MacOS/"
sed "s/__VERSION__/$VERSION/g" "$HERE/Info.plist" > "$BUILD/MNAgentBridgeReceiver.app/Contents/Info.plist"
codesign --force --sign - "$BUILD/MNAgentBridgeReceiver.app" >/dev/null 2>&1 || true

mkdir -p "$DEST_DIR"
rm -rf "$APP"
cp -R "$BUILD/MNAgentBridgeReceiver.app" "$APP"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP"
mkdir -p "$HOME/.mn-agent-bridge/inbox"
chmod 700 "$HOME/.mn-agent-bridge" "$HOME/.mn-agent-bridge/inbox"
echo "Installed $APP (scheme mnagentbridge://)"
