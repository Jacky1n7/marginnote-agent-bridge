#!/bin/sh
# Build and publish a GitHub release for the version in package.json.
# Assets: versioned .mnaddon/.tgz plus fixed names for releases/latest/download/… links.
set -eu
cd "$(dirname "$0")/.."
V=$(node -p "require('./package.json').version")
node scripts/build.mjs
rm -f dist/*.tgz
npm pack --silent --pack-destination dist >/dev/null
cp "dist/MNAgentBridge-v$V.mnaddon" dist/MNAgentBridge.mnaddon
cp "dist/marginnote-agent-bridge-$V.tgz" dist/marginnote-agent-bridge.tgz
gh release view "v$V" >/dev/null 2>&1 || gh release create "v$V" --title "v$V" --notes-file CHANGELOG.md
gh release upload "v$V" --clobber \
  "dist/MNAgentBridge-v$V.mnaddon" dist/MNAgentBridge.mnaddon \
  "dist/marginnote-agent-bridge-$V.tgz" dist/marginnote-agent-bridge.tgz
echo "released v$V"
