#!/bin/bash
set -e

# Build the SPA first so it can be embedded into the backend binary.
echo "Building SPA (frontend)..."
(cd ../frontend && npm run build)

echo "Building backend executable..."
cd "$(dirname "$0")"
source venv/bin/activate

SEP=":"
[ "$(uname -s)" = "MINGW64_NT-*" ] || [ "$OSTYPE" = "msys" ] || [ "$OSTYPE" = "cygwin" ] && SEP=";"

pyinstaller --noconfirm --name antigravity-backend --onefile \
  --add-data "../frontend/dist${SEP}web" \
  --add-data "bin/cloudflared${SEP}bin" \
  --hidden-import=uvicorn.logging \
  --hidden-import=uvicorn.loops \
  --hidden-import=uvicorn.loops.auto \
  --hidden-import=uvicorn.protocols \
  --hidden-import=uvicorn.protocols.http \
  --hidden-import=uvicorn.protocols.http.auto \
  --hidden-import=uvicorn.protocols.websockets \
  --hidden-import=uvicorn.protocols.websockets.auto \
  --hidden-import=uvicorn.lifespan \
  --hidden-import=uvicorn.lifespan.on \
  --hidden-import=uvicorn.lifespan.off \
  --hidden-import=dotenv \
  --hidden-import=pydantic \
  --hidden-import=pydantic_settings \
  main.py

echo "Backend build complete. Artifact: backend/dist/antigravity-backend*"