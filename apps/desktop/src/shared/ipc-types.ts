// Typed IPC contract between main and renderer
export interface IpcChannels {
  'dialog:selectDirectory': () => string | null;
  'dialog:selectFiles': () => string[];
  'app:getVersion': () => string;
  'app:getPlatform': () => string;
  'events:subscribe': () => boolean;
}
