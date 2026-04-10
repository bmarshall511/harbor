#!/usr/bin/env node

/**
 * dev-web.mjs — Start the Harbor web dev server on an available port.
 *
 * Finds a free port, writes it to data/.harbor-dev-port, then starts Next.js.
 * The port is printed clearly so you know where to open the browser.
 */

import { createServer } from 'node:net';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

/**
 * Load .env from the monorepo root into process.env.
 * Next.js only reads .env from its own cwd (apps/web), so we need to
 * load the root .env before spawning Next.js.
 */
function loadRootEnv() {
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // Don't override already-set env vars
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadRootEnv();
const PORT_FILE = join(ROOT, 'data', '.harbor-dev-port');
const START_PORT = parseInt(process.env.PORT || '3000', 10);
const MAX_ATTEMPTS = 20;

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '0.0.0.0');
  });
}

async function main() {
  // Find a free port
  let port = START_PORT;
  let found = false;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    if (await isPortFree(START_PORT + i)) {
      port = START_PORT + i;
      found = true;
      break;
    }
  }

  if (!found) {
    console.error(`No free port found in range ${START_PORT}-${START_PORT + MAX_ATTEMPTS - 1}`);
    process.exit(1);
  }

  // Write port file for Electron and other tools
  mkdirSync(dirname(PORT_FILE), { recursive: true });
  writeFileSync(PORT_FILE, String(port), 'utf-8');

  if (port !== START_PORT) {
    console.log(`\n  Port ${START_PORT} is in use. Using port ${port} instead.\n`);
  }

  // Start Next.js
  const next = spawn('npx', ['next', 'dev', '--port', String(port)], {
    cwd: join(ROOT, 'apps', 'web'),
    stdio: 'inherit',
    env: { ...process.env, PORT: String(port) },
  });

  next.on('exit', (code) => process.exit(code ?? 0));

  // Forward signals
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      next.kill(sig);
    });
  }
}

main();
