#!/bin/bash
echo "Starting Antigravity Hub in FAST Mode..."

# Start Backend
echo "Starting FastAPI Backend..."
cd backend
source venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
cd ..

# Build and Start Frontend in Preview Mode (Bundled)
echo "Building Vite Frontend for fast loading..."
cd frontend
npm run build

echo "Starting Vite Preview Server..."
npm run preview -- --host 0.0.0.0 --port 5173 &
FRONTEND_PID=$!
cd ..

echo "Antigravity Hub is running FAST."
echo "Backend PID: $BACKEND_PID"
echo "Frontend PID: $FRONTEND_PID"
echo "Press Ctrl+C to stop both servers."

# Wait for Ctrl+C
trap "kill $BACKEND_PID $FRONTEND_PID; exit" SIGINT SIGTERM
wait
