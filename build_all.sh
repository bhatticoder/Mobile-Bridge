#!/bin/bash
set -e

echo "Starting Antigravity Master Build (Linux)"

echo "1. Building SPA (frontend)..."
(cd frontend && npm run build)

echo "2. Building Python Backend..."
./backend/build_backend.sh

echo "3. Building Electron Desktop App..."
(cd frontend && npm run electron:build:linux)

echo "Build complete! The Linux AppImage/deb can be found in frontend/release/"