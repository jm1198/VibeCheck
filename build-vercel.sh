#!/usr/bin/env bash
# Build Vite frontend + bundle Express server for Vercel.
set -euo pipefail
cd "$(dirname "$0")"
umask 002

echo "[1/4] Installing dependencies"
bun install

echo "[2/4] Building Vite frontend"
bun run build

echo "[3/4] Assembling .vercel/output"
rm -rf .vercel/output
mkdir -p .vercel/output/functions/render.func

# Static files from Vite build
cp -R dist .vercel/output/static

echo "[4/4] Bundling server into render function"
bun build vercel-entry.ts --target node \
  --outfile .vercel/output/functions/render.func/index.mjs \
  --external:better-sqlite3

# Copy index.html alongside the function so the SPA fallback can serve it
cp dist/index.html .vercel/output/functions/render.func/index.html

cat > .vercel/output/functions/render.func/.vc-config.json <<'JSON'
{ "runtime": "nodejs22.x", "handler": "index.mjs", "launcherType": "Nodejs", "supportsResponseStreaming": true }
JSON
cat > .vercel/output/config.json <<'JSON'
{ "version": 3, "routes": [ { "handle": "filesystem" }, { "src": "/(.*)", "dest": "/render" } ] }
JSON

echo "done -> .vercel/output ready for: bunx vercel deploy --prebuilt"
