import { contextBridge, ipcRenderer } from 'electron';

// Expose a safe, typed API to the renderer
const harborApi = {
  selectDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:selectDirectory'),

  selectFiles: (): Promise<string[]> =>
    ipcRenderer.invoke('dialog:selectFiles'),

  getVersion: (): Promise<string> =>
    ipcRenderer.invoke('app:getVersion'),

  getPlatform: (): Promise<string> =>
    ipcRenderer.invoke('app:getPlatform'),

  subscribeToEvents: (): Promise<boolean> =>
    ipcRenderer.invoke('events:subscribe'),

  onEvent: (callback: (event: unknown) => void) => {
    const listener = (_: unknown, data: unknown) => callback(data);
    ipcRenderer.on('harbor:event', listener);
    return () => ipcRenderer.removeListener('harbor:event', listener);
  },
};

contextBridge.exposeInMainWorld('harbor', harborApi);

// Type declaration for renderer
declare global {
  interface Window {
    harbor: typeof harborApi;
  }
}
