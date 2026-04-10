import { ipcMain, dialog, type BrowserWindow } from 'electron';
import type { IpcChannels } from '../shared/ipc-types.js';

export function registerIpcHandlers(mainWindow: BrowserWindow) {
  // Select directory
  ipcMain.handle('dialog:selectDirectory' satisfies keyof IpcChannels, async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  // Select files
  ipcMain.handle('dialog:selectFiles' satisfies keyof IpcChannels, async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled) return [];
    return result.filePaths;
  });

  // Get app version
  ipcMain.handle('app:getVersion' satisfies keyof IpcChannels, () => {
    const { app } = require('electron');
    return app.getVersion();
  });

  // Platform info
  ipcMain.handle('app:getPlatform' satisfies keyof IpcChannels, () => {
    return process.platform;
  });

  // Forward realtime events from main to renderer
  // This would subscribe to the event bus and forward via IPC
  ipcMain.handle('events:subscribe' satisfies keyof IpcChannels, () => {
    // Placeholder — would connect SSE or direct event bus here
    return true;
  });
}
