/**
 * Server Launcher
 *
 * Auto-starts dev servers before discovery/testing if not already running.
 * Supports single-service (legacy) and multi-service with dependency ordering.
 */

import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import type { ServiceConfig } from '../config/types.js';

let _serverProcess: ChildProcess | null = null;
const _serviceProcesses = new Map<string, ChildProcess>();

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
    return resp.status >= 200 && resp.status < 400;
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

// ── Multi-Service Support ──────────────────────────────────

export interface MultiServiceResult {
  services: Map<string, ServerStartResult>;
  allHealthy: boolean;
  errors: string[];
}

/**
 * Topological sort services by dependsOn.
 * Returns tiers: each tier's services can start after all previous tiers are healthy.
 */
function topoSort(services: ServiceConfig[]): ServiceConfig[][] {
  const byName = new Map(services.map(s => [s.name, s]));
  const resolved = new Set<string>();
  const tiers: ServiceConfig[][] = [];

  let remaining = [...services];
  let maxIter = services.length + 1;
  while (remaining.length > 0 && maxIter-- > 0) {
    const tier = remaining.filter(s =>
      !s.dependsOn || s.dependsOn.every(d => resolved.has(d))
    );
    if (tier.length === 0) {
      throw new Error(
        `Circular dependency in services: ${remaining.map(s => s.name).join(', ')}`
      );
    }
    tiers.push(tier);
    for (const s of tier) resolved.add(s.name);
    remaining = remaining.filter(s => !resolved.has(s.name));
  }
  return tiers;
}

/**
 * Start a single service, with optional install fallback.
 */
async function startService(
  service: ServiceConfig,
  projectRoot: string,
): Promise<ServerStartResult> {
  const healthUrl = `http://localhost:${service.port}${service.healthCheck}`;
  const cwd = service.cwd ? resolve(projectRoot, service.cwd) : projectRoot;
  const timeout = service.startTimeout || 30000;

  // Already running?
  if (await isServerUp(healthUrl)) {
    console.log(`  ✓ ${service.name} already running on :${service.port}`);
    return { alreadyRunning: true, started: false };
  }

  console.log(`  Starting ${service.name}: ${service.command}`);

  // Try starting; if command not found and installCommand exists, install first
  let child: ChildProcess;
  try {
    child = spawn(service.command, [], {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      env: { ...process.env, ...(service.env || {}) },
    });
  } catch (err) {
    if (service.installCommand) {
      console.log(`  Installing deps for ${service.name}: ${service.installCommand}`);
      try {
        execSync(service.installCommand, { cwd, stdio: 'pipe', timeout: 120000 });
      } catch (installErr) {
        return {
          alreadyRunning: false,
          started: false,
          error: `Install failed for ${service.name}: ${(installErr as Error).message}`,
        };
      }
      child = spawn(service.command, [], {
        cwd,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
        env: { ...process.env, ...(service.env || {}) },
      });
    } else {
      return {
        alreadyRunning: false,
        started: false,
        error: `Failed to start ${service.name}: ${(err as Error).message}`,
      };
    }
  }

  child.unref();
  _serviceProcesses.set(service.name, child);

  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  child.on('error', (err) => {
    console.error(`  ${service.name} error: ${err.message}`);
  });

  // If the command exits immediately, it might need deps installed
  let exited = false;
  let exitCode: number | null = null;
  child.on('exit', (code) => {
    exited = true;
    exitCode = code;
  });

  // Give it a moment to see if it exits immediately
  await new Promise(r => setTimeout(r, 1500));

  if (exited && exitCode !== 0 && service.installCommand) {
    console.log(`  ${service.name} exited (code ${exitCode}). Running install: ${service.installCommand}`);
    try {
      execSync(service.installCommand, { cwd, stdio: 'pipe', timeout: 120000 });
    } catch {
      return {
        alreadyRunning: false,
        started: false,
        error: `Install for ${service.name} failed.\nstderr: ${stderr.substring(0, 500)}`,
      };
    }
    // Retry
    child = spawn(service.command, [], {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      env: { ...process.env, ...(service.env || {}) },
    });
    child.unref();
    _serviceProcesses.set(service.name, child);
    stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  }

  console.log(`  Waiting up to ${timeout / 1000}s for ${service.name} on :${service.port}...`);
  const ready = await waitForServer(healthUrl, timeout);

  if (!ready) {
    try { process.kill(-child.pid!, 'SIGTERM'); } catch {}
    _serviceProcesses.delete(service.name);
    return {
      alreadyRunning: false,
      started: false,
      error: `${service.name} did not respond at :${service.port} within ${timeout / 1000}s.\nstderr: ${stderr.substring(0, 500)}`,
    };
  }

  console.log(`  ✓ ${service.name} ready on :${service.port}`);
  return { alreadyRunning: false, started: true, process: child };
}

/**
 * Ensure all services are running, respecting dependency order.
 * Falls back to legacy single-service mode if no services[] defined.
 */
export async function ensureAllServicesRunning(
  services: ServiceConfig[],
  projectRoot: string,
): Promise<MultiServiceResult> {
  const results = new Map<string, ServerStartResult>();
  const errors: string[] = [];

  const tiers = topoSort(services);

  for (const tier of tiers) {
    // Start all services in this tier in parallel
    const tierResults = await Promise.all(
      tier.map(async (svc) => {
        const result = await startService(svc, projectRoot);
        return { name: svc.name, result };
      })
    );

    for (const { name, result } of tierResults) {
      results.set(name, result);
      if (!result.alreadyRunning && !result.started) {
        errors.push(result.error || `${name} failed to start`);
      }
    }

    // If any service in this tier failed, don't start next tier
    if (errors.length > 0) break;
  }

  return {
    services: results,
    allHealthy: errors.length === 0,
    errors,
  };
}

/**
 * Stop all services that we started.
 */
export function stopAllServices(): void {
  for (const [name, child] of _serviceProcesses) {
    try {
      process.kill(-child.pid!, 'SIGTERM');
      console.log(`  ${name} stopped.`);
    } catch {
      // Already dead
    }
  }
  _serviceProcesses.clear();
}
