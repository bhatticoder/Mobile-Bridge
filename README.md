# Antigravity Mobile Remote Controller & Live Testing Hub

A cross-platform, self-hosted web interface to control Antigravity agents, manage projects, and test dev servers directly from your mobile device.

## Features
- **Project Management**: Select or clone projects from your workspace directory.
- **Agent Console**: Send prompts to the Antigravity agent via WebSockets with real-time feedback (mocked in this version).
- **Process Manager**: Start and stop dev servers (e.g., `npm run dev`) isolated per project.
- **Live Preview**: Embedded browser view to test mobile and desktop layouts for running dev servers.
- **PWA Ready**: Add the frontend to your mobile home screen for a native app feel.

## Prerequisites
- Python 3.10+
- Node.js 18+
- Git

## Setup

1. **Configure Environment**
   Edit `backend/.env` to point to your workspace folder and set an authentication PIN:
   ```
   WORKSPACE_DIR="/path/to/your/projects"
   AUTH_PIN="1234"
   ```

2. **First-time Setup**
   The setup scripts will automatically install the necessary packages. You must have run `npm install` inside the `frontend` folder.

## Running the Hub

**On Linux / macOS:**
```bash
./start.sh
```

**On Windows:**
```cmd
start.bat
```

The frontend will be available at `http://localhost:5173`. You can log in using the `AUTH_PIN` from your `.env` file.

## Exposing to the Internet

To access the Hub from your phone remotely, use a secure tunnel. **Do not expose this directly to the public internet without a tunnel.**

### Option 1: Tailscale (Recommended)
1. Install Tailscale on your host machine and mobile device.
2. The Hub will be accessible from your phone's browser at `http://<your-machine-tailscale-ip>:5173`.

### Option 2: Cloudflare Tunnel
1. Install `cloudflared`.
2. Run the tunnel pointing to the frontend port:
   ```bash
   cloudflared tunnel --url http://localhost:5173
   ```
3. (Optional) Set up Cloudflare Access to protect the URL.
