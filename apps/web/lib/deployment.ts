/**
 * Deployment mode detection.
 *
 * Harbor supports two deployment modes controlled by the
 * `HARBOR_DEPLOYMENT_MODE` env var:
 *
 *   • `"local"` (default) — Full features: local filesystem archives,
 *     file watcher, ffmpeg/sharp preview generation, metadata JSON on
 *     local disk. For desktop / self-hosted / Electron deployments.
 *
 *   • `"cloud"` — Dropbox-only mode for serverless (Vercel). No local
 *     filesystem access, metadata written to Dropbox via API, previews
 *     via Dropbox thumbnail API, cron-based Dropbox change polling.
 *
 * The mode is read once at import time and cached for the lifetime of
 * the server process. Serverless cold starts re-read it naturally.
 */

export type DeploymentMode = 'local' | 'cloud';

export const DEPLOYMENT_MODE: DeploymentMode =
  (process.env.HARBOR_DEPLOYMENT_MODE as DeploymentMode) || 'local';

export const isCloudMode = DEPLOYMENT_MODE === 'cloud';
export const isLocalMode = DEPLOYMENT_MODE === 'local';
