#!/usr/bin/env bash
# Rebuild the site and (re)start the production server on port 3000.
set -euo pipefail
cd "$(dirname "$0")"

umask 002
mkdir -p .run

bun install
bun run build
setsid nohup bun run start > .run/server.log 2>&1 < /dev/null &

for _ in $(seq 1 50); do
  if curl -sf -o /dev/null http://localhost:3000; then
    echo "VibeCheck published; serving on port 3000"
    exit 0
  fi
  sleep 0.2
done
echo "warning: published, but the server isn't responding — check .run/server.log" >&2
exit 1
