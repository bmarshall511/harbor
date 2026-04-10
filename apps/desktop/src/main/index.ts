import { app, BrowserWindow, shell } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { registerIpcHandlers } from './ipc-handlers';

const isDev = !app.isPackaged;

/**
 * Read the port chosen by scripts/dev-web.mjs from data/.harbor-dev-port.
 * Falls back to PORT env, then 3000.
 */
function getDevPort(): number {
  const portFile = path.resolve(__dirname, '..', '..', '..', '..', 'data', '.harbor-dev-port');
  try {
    const port = parseInt(fs.readFileSync(portFile, 'utf-8').trim(), 10);
    if (port > 0 && port < 65536) return port;
  } catch {
    // Port file doesn't exist yet
  }
  return parseInt(process.env.PORT || '3000', 10);
}

let mainWindow: BrowserWindow | null = null;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0a0e1a',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  registerIpcHandlers(mainWindow);

  if (isDev) {
    const port = getDevPort();
    console.log(`Loading dev server at http://localhost:${port}`);
    await mainWindow.loadURL(`http://localhost:${port}`);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../../web/.next/server/app/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
});
