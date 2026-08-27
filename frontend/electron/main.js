const { app, BrowserWindow } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const http = require('http');

const BACKEND_URL = 'http://127.0.0.1:8000';

let mainWindow;
let backendProcess;

function defaultConfig() {
  return {
    workspaceDir: process.env.WORKSPACE_DIR || '~/dev-projects',
    pin: process.env.AUTH_PIN || '1234',
    agentCommand: process.env.AGENT_COMMAND || 'opencode run --format json --dangerously-skip-permissions',
    cloudflaredPath: process.env.CLOUDFLARED_PATH || ''
  };
}

function loadConfig() {
  const cfgPath = path.join(app.getPath('userData'), 'hub-config.json');
  const defaults = defaultConfig();
  let cfg = defaults;
  try {
    const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    cfg = { ...defaults, ...parsed };
  } catch {
    try {
      fs.writeFileSync(cfgPath, JSON.stringify(defaults, null, 2));
    } catch {}
  }
  return { cfg, cfgPath };
}

function checkBackendReady(url, maxAttempts = 60, interval = 1000) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      attempts++;
      http.get(url, (res) => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          retry();
        }
      }).on('error', retry);
    };

    const retry = () => {
      if (attempts >= maxAttempts) {
        reject(new Error('Backend did not start in time.'));
      } else {
        setTimeout(check, interval);
      }
    };
    check();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Antigravity Hub',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    autoHideMenuBar: true,
  });

  mainWindow.loadURL(BACKEND_URL);
}

app.whenReady().then(async () => {
  // Start the Python backend if packaged
  if (app.isPackaged) {
    const { cfg, cfgPath } = loadConfig();

    let backendExecutable;
    if (process.platform === 'win32') {
      backendExecutable = path.join(process.resourcesPath, 'backend', 'antigravity-backend.exe');
    } else {
      backendExecutable = path.join(process.resourcesPath, 'backend', 'antigravity-backend');
    }

    // Make CLI agent binaries discoverable when launched from a GUI.
    const extraPaths = [path.join(os.homedir(), '.opencode', 'bin')];
    const env = {
      ...process.env,
      PATH: [...extraPaths, process.env.PATH].filter(Boolean).join(path.delimiter),
      WORKSPACE_DIR: cfg.workspaceDir,
      AUTH_PIN: cfg.pin,
      AGENT_COMMAND: cfg.agentCommand,
      ...(cfg.cloudflaredPath ? { CLOUDFLARED_PATH: cfg.cloudflaredPath } : {})
    };

    console.log('Starting backend: ', backendExecutable);
    console.log('Config file: ', cfgPath);
    backendProcess = spawn(backendExecutable, [], { env, detached: false });

    backendProcess.stdout.on('data', (data) => console.log(`Backend: ${data}`));
    backendProcess.stderr.on('data', (data) => console.error(`Backend Error: ${data}`));

    try {
      console.log('Waiting for backend to be ready...');
      await checkBackendReady(BACKEND_URL + '/health');
      console.log('Backend is ready!');
    } catch (err) {
      console.error(err);
    }
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (backendProcess) {
    backendProcess.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});