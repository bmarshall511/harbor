const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(bytes: number, decimals: number = 1): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);
  return `${value.toFixed(i === 0 ? 0 : decimals)} ${UNITS[i]}`;
}
