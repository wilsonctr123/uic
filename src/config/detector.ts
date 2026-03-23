/**
 * Framework/Stack Auto-Detector
 *
 * Inspects a project directory to detect the frontend framework,
 * package manager, router, and auth model. Used by `uic init` to
 * generate a sensible default config.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface DetectionResult {
  framework: string;
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun';
  router?: string;
  devCommand?: string;
  baseUrl?: string;
  hasSrc: boolean;
  hasPlaywright: boolean;
  hasExistingTests: boolean;
  authModel?: string;
  seedRoutes: string[];
  notes: string[];
}

export function detectStack(projectRoot: string): DetectionResult {
  const result: DetectionResult = {
    framework: 'unknown',
    packageManager: 'npm',
    hasSrc: false,
    hasPlaywright: false,
    hasExistingTests: false,
    seedRoutes: ['/'],
    notes: [],
  };

  // Detect package manager
  if (existsSync(join(projectRoot, 'bun.lockb'))) result.packageManager = 'bun';
  else if (existsSync(join(projectRoot, 'pnpm-lock.yaml'))) result.packageManager = 'pnpm';
  else if (existsSync(join(projectRoot, 'yarn.lock'))) result.packageManager = 'yarn';

  // Find package.json (may be in subdirectory for monorepos)
  const pkgPaths = [
    join(projectRoot, 'package.json'),
    join(projectRoot, 'web/package.json'),
    join(projectRoot, 'frontend/package.json'),
    join(projectRoot, 'client/package.json'),
    join(projectRoot, 'app/package.json'),
  ];

  let pkgJson: Record<string, any> | undefined;
  let pkgDir: string = projectRoot;

  for (const p of pkgPaths) {
    if (existsSync(p)) {
      try {
        pkgJson = JSON.parse(readFileSync(p, 'utf-8'));
        pkgDir = p.replace('/package.json', '');
        break;
      } catch { /* skip */ }
    }
  }

  if (pkgJson) {
    const allDeps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };

    // Detect framework
    if (allDeps['next']) {
      result.framework = 'nextjs';
      result.devCommand = 'npm run dev';
      result.baseUrl = 'http://localhost:3000';
    } else if (allDeps['nuxt'] || allDeps['nuxt3']) {
      result.framework = 'nuxt';
      result.devCommand = 'npm run dev';
      result.baseUrl = 'http://localhost:3000';
    } else if (allDeps['@sveltejs/kit']) {
      result.framework = 'sveltekit';
      result.devCommand = 'npm run dev';
      result.baseUrl = 'http://localhost:5173';
    } else if (allDeps['react'] && allDeps['vite']) {
      result.framework = 'react-vite';
      result.devCommand = `cd ${pkgDir === projectRoot ? '.' : pkgDir.replace(projectRoot + '/', '')} && npm run dev`;
      result.baseUrl = 'http://localhost:5173';
    } else if (allDeps['react']) {
      result.framework = 'react';
      result.devCommand = 'npm start';
      result.baseUrl = 'http://localhost:3000';
    } else if (allDeps['vue']) {
      result.framework = 'vue';
      result.devCommand = 'npm run dev';
      result.baseUrl = 'http://localhost:5173';
    } else if (allDeps['@angular/core']) {
      result.framework = 'angular';
      result.devCommand = 'ng serve';
      result.baseUrl = 'http://localhost:4200';
    } else if (allDeps['svelte']) {
      result.framework = 'svelte';
      result.devCommand = 'npm run dev';
      result.baseUrl = 'http://localhost:5173';
    }

    // Detect router
    if (allDeps['react-router-dom'] || allDeps['react-router']) result.router = 'react-router';
    else if (allDeps['@tanstack/react-router']) result.router = 'tanstack-router';
    else if (allDeps['vue-router']) result.router = 'vue-router';

    // Detect Playwright
    if (allDeps['@playwright/test'] || allDeps['playwright']) {
      result.hasPlaywright = true;
    }

    // Detect existing tests
    if (pkgJson.scripts?.['test:e2e'] || pkgJson.scripts?.['e2e']) {
      result.hasExistingTests = true;
    }
  }

  // Detect auth patterns from source
  const authPatterns = [
    { file: 'src/auth', model: 'custom-auth' },
    { file: 'src/api/auth.py', model: 'fastapi-auth' },
    { file: 'src/middleware/auth', model: 'middleware-auth' },
    { file: 'pages/api/auth', model: 'nextauth' },
  ];

  for (const { file, model } of authPatterns) {
    if (existsSync(join(projectRoot, file)) || existsSync(join(projectRoot, file + '.ts')) || existsSync(join(projectRoot, file + '.js'))) {
      result.authModel = model;
      break;
    }
  }

  // Try to detect seed routes from router config
  result.seedRoutes = detectSeedRoutes(projectRoot, pkgDir, result.framework);

  return result;
}

function detectSeedRoutes(root: string, pkgDir: string, framework: string): string[] {
  const routes: string[] = ['/'];

  // Try reading common router config files
  const routerFiles = [
    join(pkgDir, 'src/App.tsx'),
    join(pkgDir, 'src/App.jsx'),
    join(pkgDir, 'src/app/routes.ts'),
    join(pkgDir, 'src/router.ts'),
    join(pkgDir, 'src/router/index.ts'),
  ];

  for (const rf of routerFiles) {
    if (!existsSync(rf)) continue;
    try {
      const content = readFileSync(rf, 'utf-8');
      // Extract path="..." patterns from JSX Route elements
      const pathMatches = content.matchAll(/path[=:]\s*["']([^"']+)["']/g);
      for (const match of pathMatches) {
        const p = match[1];
        if (p && !p.includes(':') && !routes.includes(p)) {
          routes.push(p);
        }
      }
    } catch { /* skip */ }
  }

  // For Next.js, scan pages/app directory
  if (framework === 'nextjs') {
    const appDir = join(pkgDir, 'app');
    const pagesDir = join(pkgDir, 'pages');
    // Would scan directory structure — simplified for now
  }

  return routes;
}
