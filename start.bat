@echo off
echo Starting Antigravity Hub...

:: Start Backend
echo Starting FastAPI Backend...
start "Backend" cmd /k "cd backend && venv\Scripts\activate && uvicorn main:app --host 0.0.0.0 --port 8000"

:: Start Frontend
echo Starting Vite Frontend...
start "Frontend" cmd /k "cd frontend && npm run dev -- --host 0.0.0.0"

echo Antigravity Hub is running in separate windows.
pause
