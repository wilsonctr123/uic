/**
 * Config Loader
 *
 * Loads uic.config.ts from the consumer repository.
 * Supports environment variable interpolation in string values.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import type { UicConfig } from './types.js';

/**
 * Load .env file from project root into process.env.
 * Only sets vars that are not already set (env takes precedence).
 */
function loadDotEnv(projectRoot: string): void {
  const envPath = join(projectRoot, '.env');
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const key = trimmed.substring(0, eqIdx).trim();
    let val = trimmed.substring(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
      val = val.slice(1, -1);
    }
    // Only set if not already in environment (real env wins)
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

const DEFAULT_CONFIG: Partial<UicConfig> = {
  discovery: {
    seedRoutes: ['/'],
    maxDepth: 3,
    waitAfterNavigation: 500,
    viewportWidth: 1440,
    viewportHeight: 900,
    screenshots: true,
  },
  contract: {
    path: '.uic/contract.json',
    inventoryPath: '.uic/inventory.json',
    reportPath: '.uic/report.json',
    testResultsPath: '.uic/test-results.json',
  },
};

/**
 * Resolve environment variable references like ${ENV_VAR} in strings.
 */
function interpolateEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (match, envVar) => {
    const val = process.env[envVar];
    if (val === undefined) {
      const sensitivePatterns = ['PASSWORD', 'KEY', 'SECRET', 'TOKEN'];
      const isSensitive = sensitivePatterns.some(p => envVar.toUpperCase().includes(p));
      if (isSensitive) {
        console.error(`ERROR: Required env var \${${envVar}} is not set (contains sensitive credential)`);
      } else {
        console.warn(`WARNING: Env var \${${envVar}} is not set, defaulting to empty string`);
      }
      return '';
    }
    return val;
  });
}

/**
 * Deep-interpolate env vars in all string values of an object.
 */
function interpolateDeep<T>(obj: T): T {
  if (typeof obj === 'string') return interpolateEnvVars(obj) as T;
  if (Array.isArray(obj)) return obj.map(interpolateDeep) as T;
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      result[key] = interpolateDeep(val);
    }
    return result as T;
  }
  return obj;
}

/**
 * Deep merge two objects (source wins on conflict).
 */
function deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = target[key];
    if (sv && typeof sv === 'object' && !Array.isArray(sv) && tv && typeof tv === 'object' && !Array.isArray(tv)) {
      result[key] = deepMerge(tv, sv);
    } else if (sv !== undefined) {
      result[key] = sv;
    }
  }
  return result;
}

/**
 * Load and validate a uic.config.ts file from the given project root.
 */
export async function loadConfig(projectRoot: string): Promise<UicConfig> {
  // Load .env before anything else so ${ENV_VAR} interpolation works
  loadDotEnv(projectRoot);

  const configNames = [
    'uic.config.ts',
    'uic.config.js',
    'uic.config.mjs',
    '.uic/config.ts',
    '.uic/config.js',
  ];

  // Search current dir, then walk up parent directories (like package.json resolution)
  let configPath: string | undefined;
  const searchedDirs: string[] = [];
  let searchDir = projectRoot;
  for (let depth = 0; depth < 10; depth++) {
    searchedDirs.push(searchDir);
    for (const name of configNames) {
      const candidate = join(searchDir, name);
      if (existsSync(candidate)) {
        configPath = candidate;
        break;
      }
    }
    if (configPath) break;
    const parent = dirname(searchDir);
    if (parent === searchDir) break; // filesystem root
    searchDir = parent;
  }

  if (!configPath) {
    console.error('No uic config file found. Run `uic init` to create one.');
    console.error('Searched:', searchedDirs.map(d => configNames.map(n => join(d, n))).flat().join(', '));
    process.exit(1);
  }

  try {
    let userConfig: Partial<UicConfig>;

    if (configPath.endsWith('.ts')) {
      // For .ts config files: strip TS syntax and eval the object literal.
      // This avoids needing tsx/ts-node at runtime.
      const raw = readFileSync(configPath, 'utf-8');

      // Remove all import lines
      let stripped = raw.replace(/^\s*import\s+.*$/gm, '');
      // Remove satisfies clauses
      stripped = stripped.replace(/\bsatisfies\s+\w+/g, '');
      // Remove 'as X' type assertions
      stripped = stripped.replace(/\bas\s+\w+/g, '');
      // Remove 'export default' to get the raw object
      stripped = stripped.replace(/export\s+default\s+/, '');
      // Trim trailing semicolons
      stripped = stripped.trim().replace(/;$/, '');

      // Protect ${...} env var references inside string literals from being
      // interpreted as JS template expressions. Only replace inside quotes.
      const escaped = stripped.replace(
        /(['"])((?:[^'"\\\n]|\\.)*)(['"])/g,
        (_match, q1, content, q2) => {
          const safe = content.replace(/\$\{/g, '__ENVVAR__');
          return `${q1}${safe}${q2}`;
        }
      );

      try {
        const fn = new Function(`"use strict"; return (${escaped});`);
        const result = fn();

        // Restore the ${...} references in all string values
        const restore = (obj: any): any => {
          if (typeof obj === 'string') {
            return obj.replace(/__ENVVAR__/g, '${');
          }
          if (Array.isArray(obj)) return obj.map(restore);
          if (obj && typeof obj === 'object') {
            const out: Record<string, any> = {};
            for (const [k, v] of Object.entries(obj)) {
              out[k] = restore(v);
            }
            return out;
          }
          return obj;
        };

        userConfig = restore(result);
      } catch (evalErr) {
        // Fallback: try dynamic import (works if tsx/ts-node is available)
        const configModule = await import(resolve(configPath));
        userConfig = configModule.default || configModule;
      }
    } else {
      // JS/MJS: dynamic import works natively
      const configModule = await import(resolve(configPath));
      userConfig = configModule.default || configModule;
    }

    // Merge with defaults
    const merged = deepMerge(DEFAULT_CONFIG as any, userConfig as any) as UicConfig;

    // Interpolate env vars
    return interpolateDeep(merged) as UicConfig;
  } catch (err) {
    console.error(`Failed to load config from ${configPath}:`, err);
    process.exit(1);
  }
}

/**
 * Get resolved paths for artifacts.
 */
export function getArtifactPaths(projectRoot: string, config: UicConfig) {
  const c = config.contract || {};
  return {
    contract: resolve(projectRoot, c.path || '.uic/contract.json'),
    inventory: resolve(projectRoot, c.inventoryPath || '.uic/inventory.json'),
    report: resolve(projectRoot, c.reportPath || '.uic/report.json'),
    testResults: resolve(projectRoot, c.testResultsPath || '.uic/test-results.json'),
    authDir: resolve(projectRoot, '.uic/auth'),
    screenshotDir: resolve(projectRoot, '.uic/screenshots'),
  };
}
