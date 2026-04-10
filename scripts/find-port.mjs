#!/usr/bin/env node

/**
 * find-port.mjs — Find an available port for Harbor dev server.
 *
 * Tries PORT env, then 3000, then increments until it finds one free.
 * Writes the chosen port to data/.harbor-dev-port so other tools
 * (like Electron) can discover it.
 *
 * Usage:
 *   node scripts/find-port.mjs          → prints port number to stdout
 *   PORT=4000 node scripts/find-port.mjs → starts searching from 4000
 */

import { createServer } from 'node:net';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
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

async function findPort() {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const port = START_PORT + i;
    if (await isPortFree(port)) {
      // Write to port file so Electron and other tools can find it
      mkdirSync(dirname(PORT_FILE), { recursive: true });
      writeFileSync(PORT_FILE, String(port), 'utf-8');
      // Print to stdout — this is what callers consume
      process.stdout.write(String(port));
      return;
    }
  }
  process.stderr.write(
    `ERROR: No free port found in range ${START_PORT}-${START_PORT + MAX_ATTEMPTS - 1}\n`,
  );
  process.exit(1);
}

findPort();
