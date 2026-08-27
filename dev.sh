#!/bin/bash
set -e

echo "== Antigravity Hub DEV (hot-reload) =="
echo "Backend :8000 (tunnel auto-start) | Vite dev :5173"

cd "$(dirname "$0")/backend"
source venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

cd ../frontend
trap "kill $BACKEND_PID 2>/dev/null" EXIT
npm run dev -- --host 0.0.0.0