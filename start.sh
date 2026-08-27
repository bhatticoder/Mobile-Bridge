#!/bin/bash
set -e

echo "== Antigravity Hub (web + API + internet tunnel) =="

# 1. Build the SPA so the backend can serve it (the phone's tunnel URL hits the backend directly).
echo "[1/2] Building web frontend..."
(cd "$(dirname "$0")/frontend" && npm run build)

# 2. Start the backend which serves the app, REST API and WebSockets on :8000
#    and auto-starts the Cloudflare quick tunnel.
echo "[2/2] Starting backend on http://$HOSTNAME:8000 ..."
cd "$(dirname "$0")/backend"
source venv/bin/activate
exec uvicorn main:app --host 0.0.0.0 --port 8000