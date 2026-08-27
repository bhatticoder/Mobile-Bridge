@echo off
setlocal

echo == Antigravity Hub (web + API + internet tunnel) ==

echo [1/2] Building web frontend...
cd frontend
call npm run build
if errorlevel 1 goto :error
cd ..

echo [2/2] Starting backend on port 8000 ...
cd backend
call venv\Scripts\activate.bat
uvicorn main:app --host 0.0.0.0 --port 8000
goto :eof

:error
echo BUILD FAILED
exit /b 1