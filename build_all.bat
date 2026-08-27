@echo off
setlocal

echo Building Antigravity Master Build (Windows)

echo 1. Building SPA (frontend)...
cd frontend
call npm run build
if errorlevel 1 goto :error
cd ..

echo 2. Building Python Backend...
pushd backend
call venv\Scripts\activate.bat
pyinstaller --noconfirm --name antigravity-backend --onefile ^
  --add-data "..\frontend\dist;web" ^
  --add-data "bin\cloudflared;bin" ^
  --hidden-import=uvicorn.logging ^
  --hidden-import=uvicorn.loops ^
  --hidden-import=uvicorn.loops.auto ^
  --hidden-import=uvicorn.protocols ^
  --hidden-import=uvicorn.protocols.http ^
  --hidden-import=uvicorn.protocols.http.auto ^
  --hidden-import=uvicorn.protocols.websockets ^
  --hidden-import=uvicorn.protocols.websockets.auto ^
  --hidden-import=uvicorn.lifespan ^
  --hidden-import=uvicorn.lifespan.on ^
  --hidden-import=uvicorn.lifespan.off ^
  --hidden-import=dotenv ^
  --hidden-import=pydantic ^
  --hidden-import=pydantic_settings ^
  main.py
if errorlevel 1 goto :error
popd

echo 3. Building Electron Desktop App...
cd frontend
call npm run electron:build:win
if errorlevel 1 goto :error
cd ..

echo Build complete! The Windows installer can be found in frontend/release/
goto :eof

:error
echo BUILD FAILED
exit /b 1