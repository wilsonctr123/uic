/**
 * Server Launcher
 *
 * Auto-starts the dev server before discovery/testing if it's not already running.
 * Uses the startCommand and startTimeout from project config.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { URL } from 'node:url';

let _serverProcess: ChildProcess | null = null;

/**
 * Check if a URL is responding (any HTTP status counts as "up").
 */
async function isServerUp(baseUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch(baseUrl, {
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeout);
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for a URL to become available, polling every interval ms.
 */
async function waitForServer(baseUrl: string, timeoutMs: number, intervalMs = 1000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isServerUp(baseUrl)) return true;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}

export interface ServerStartResult {
  alreadyRunning: boolean;
  started: boolean;
  process?: ChildProcess;
  error?: string;
}

/**
 * Ensure the app is running at baseUrl.
 * If not, start it using startCommand and wait for startTimeout.
 * Returns the child process if one was started (caller should clean up on exit).
 */
export async function ensureServerRunning(
  baseUrl: string,
  startCommand?: string,
  startTimeout: number = 30000,
  projectRoot: string = process.cwd(),
): Promise<ServerStartResult> {
  // Check if already running
  if (await isServerUp(baseUrl)) {
    return { alreadyRunning: true, started: false };
  }

  if (!startCommand) {
    return {
      alreadyRunning: false,
      started: false,
      error: `Server not running at ${baseUrl} and no startCommand configured.`,
    };
  }

  console.log(`  App not running at ${baseUrl}`);
  console.log(`  Starting: ${startCommand}`);

  try {
    // Split compound commands — use shell
    const child = spawn(startCommand, [], {
      cwd: projectRoot,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    _serverProcess = child;

    // Don't let the child keep the parent alive if we exit cleanly
    child.unref();

    // Collect stderr for error reporting
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      console.error(`  Server start error: ${err.message}`);
    });

    child.on('exit', (code) => {
      if (code !== null && code !== 0) {
        console.error(`  Server exited with code ${code}`);
        if (stderr) console.error(`  stderr: ${stderr.substring(0, 500)}`);
      }
    });

    // Wait for the server to come up
    console.log(`  Waiting up to ${startTimeout / 1000}s for ${baseUrl}...`);
    const ready = await waitForServer(baseUrl, startTimeout);

    if (!ready) {
      // Kill the process if it didn't start
      try { process.kill(-child.pid!, 'SIGTERM'); } catch {}
      return {
        alreadyRunning: false,
        started: false,
        error: `Server did not respond at ${baseUrl} within ${startTimeout / 1000}s.\nstderr: ${stderr.substring(0, 500)}`,
      };
    }

    console.log(`  ✓ Server ready at ${baseUrl}`);
    return { alreadyRunning: false, started: true, process: child };
  } catch (err) {
    return {
      alreadyRunning: false,
      started: false,
      error: `Failed to start server: ${(err as Error).message}`,
    };
  }
}

/**
 * Stop a server that we started.
 */
export function stopServer(result: ServerStartResult): void {
  if (result.process && result.started) {
    try {
      // Kill the process group (negative PID)
      process.kill(-result.process.pid!, 'SIGTERM');
      console.log('  Server stopped.');
    } catch {
      // Already dead
    }
  }
}

/**
 * Get the global server process (for cleanup on exit).
 */
export function getServerProcess(): ChildProcess | null {
  return _serverProcess;
}
