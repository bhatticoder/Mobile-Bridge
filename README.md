# Antigravity Mobile Remote Controller & Live Testing Hub

Control your Linux (or Windows/macOS) dev machine from your phone, over the internet.
The laptop runs a small FastAPI backend that serves the web app, the REST API, the WebSocket
agent console, and an automatic **Cloudflare quick tunnel**. Your phone opens the tunnel URL
(or scans the QR code) and gets the full hub: projects, real agent console, dev-server
terminal, and live preview.

## What you get

- **Connect tab in the app** – shows the live `https://*.trycloudflare.com` URL + QR code to
  scan from your phone, with copy / start / stop controls and the cloudflared log.
- **Real agent console** – prompts run the **opencode CLI** in the selected project and stream
  stdout/tool output back over WebSockets (with cancel). A simulated mode is available for testing.
- **Project manager** – list / clone / create projects from your workspace folder.
- **Dev-server terminal** – start/stop commands like `npm run dev`, stream logs, per project.
- **Live preview** – embedded responsive preview (mobile / desktop) of a running dev server.
- **Proper auth** – PIN login issues a random session token (Bearer header / WS token). The
  PIN is never embedded in API URLs anymore.
- **PWA** installable on Android/iOS from the tunnel URL; Electron desktop app for Linux that
  bundles the backend + cloudflared.

## Prerequisites

- Python 3.10+
- Node.js 18+
- Git
- (Optional) opencode CLI for the real agent: `curl -LsSf https://opencode.ai/install | bash`
- `cloudflared` is bundled automatically during the full build; for running from source, put
  the binary at `backend/bin/cloudflared` or install it separately (`cloudflared` on your PATH).

## Quick start (run on your laptop)

1. Configure `backend/.env`:
   ```ini
   WORKSPACE_DIR="/path/to/your/projects"
   AUTH_PIN="1234"
   AGENT_COMMAND="opencode run --format json --dangerously-skip-permissions"
   ```
   If you have no model credentials, append `--model opencode/hy3-free` (or any model you
   configured via `opencode auth login`).
2. Install dependencies (once):
   ```bash
   cd backend && python3 -m venv venv && venv/bin/pip install -r requirements.txt
   cd ../frontend && npm install
   ```
3. Run:
   ```bash
   ./start.sh          # sets everything up and starts the hub on :8000
   ```
4. Open `http://localhost:8000` on the laptop, sign in with your PIN, open the **Connect**
   tab, scan the QR code with your phone, sign in with the same PIN. Done.

For development with hot reload use `./dev.sh` (backend :8000 + Vite :5173).

## Security notes

- Do not share your tunnel URL or PIN. The tunnel is protected by your PIN (token auth).
- Prefer `cloudflared` quick tunnels only for personal use; for anything serious set up a
  named Cloudflare tunnel with Access rules instead.
- `AGENT_COMMAND` runs with `--dangerously-skip-permissions` by default: the agent can modify
  project files. Keep the PIN/token safe; the tunnel URL is public yet unguessable.

## Building distributables

**Linux desktop app (Electron)** bundles the backend (with the SPA + cloudflared embedded) and
the web shell:

```bash
./build_all.sh          # builds SPA -> pyinstaller backend -> electron-builder AppImage/deb
```

Windows: `build_all.bat` produces an NSIS installer. Artifacts land in `frontend/release/`.
The packaged desktop app looks for `hub-config.json` in its user-data folder
(`~/.config/Antigravity Hub/hub-config.json`) for `workspaceDir`, `pin`, `agentCommand`,
`cloudflaredPath`, and writes defaults on first launch.

## Troubleshooting

- **Tunnel shows "Not installed"** – drop `cloudflared` into `backend/bin/` (or set
  `CLOUDFLARED_PATH` in `.env`).
- **Tunnel connects but stays "Connecting…"** – trycloudflare registration can take ~30–40s;
  if it never resolves, the outbound connection to Cloudflare's edge is blocked on that network.
- **Agent hangs / no output** – check `opencode auth list`; configure a model with
  `opencode models`, or add `--model <provider/model>` to `AGENT_COMMAND`.