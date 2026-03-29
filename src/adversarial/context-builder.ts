/**
 * Adversarial Test Context Builder
 *
 * Builds context JSON from inventory and observations for Codex to generate
 * adversarial test cases.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

export interface AdversarialContext {
  routes: string[];
  inputElements: Array<{ route: string; placeholder: string; type: string }>;
  apiEndpoints: string[];
  appStack: string;
  existingTestCount: number;
  knownBugs: string[];
}

export function buildAdversarialContext(projectRoot: string): AdversarialContext {
  const invPath = resolve(projectRoot, '.uic/inventory.json');
  const obsPath = resolve(projectRoot, '.uic/observed-groups.json');
  const bugsPath = resolve(projectRoot, '.uic/adversarial-bugs.json');

  const context: AdversarialContext = {
    routes: [],
    inputElements: [],
    apiEndpoints: [],
    appStack: 'unknown',
    existingTestCount: 0,
    knownBugs: [],
  };

  if (existsSync(invPath)) {
    const inv = JSON.parse(readFileSync(invPath, 'utf-8'));
    context.appStack = inv.config?.framework || 'unknown';
    for (const route of inv.routes || []) {
      context.routes.push(route.path);
      for (const el of route.elements || []) {
        if (['text-input', 'email-input', 'search-input', 'textarea', 'password-input'].includes(el.classification)) {
          context.inputElements.push({
            route: route.path,
            placeholder: el.placeholder || el.label || '',
            type: el.classification,
          });
        }
      }
    }
  }

  if (existsSync(obsPath)) {
    const obs = JSON.parse(readFileSync(obsPath, 'utf-8'));
    for (const group of obs) {
      for (const req of group.observation?.networkRequests || []) {
        try {
          const url = new URL(req.url).pathname;
          if (!context.apiEndpoints.includes(url)) context.apiEndpoints.push(url);
        } catch { /* skip invalid URLs */ }
      }
    }
  }

  // Count existing tests
  const testDir = resolve(projectRoot, 'tests/e2e');
  if (existsSync(testDir)) {
    try {
      const files = readdirSync(testDir).filter(f => f.endsWith('.spec.ts'));
      context.existingTestCount = files.length;
    } catch { /* ignore */ }
  }

  // Load known bugs
  if (existsSync(bugsPath)) {
    try {
      const bugs = JSON.parse(readFileSync(bugsPath, 'utf-8'));
      context.knownBugs = bugs.map((b: any) => b.description || b.test || '');
    } catch { /* ignore */ }
  }

  return context;
}

export function buildAdversarialPrompt(context: AdversarialContext): string {
  return `You are a chaos engineer and security tester. Generate 15-20 Playwright adversarial test cases for a ${context.appStack} web application.

The app has these routes: ${context.routes.join(', ')}

Input elements:
${context.inputElements.map(e => `- ${e.route}: ${e.placeholder} (${e.type})`).join('\n')}

API endpoints discovered: ${context.apiEndpoints.join(', ') || 'none observed'}

Generate tests in these categories:
1. INPUT FUZZING (3-5 tests): empty strings, 10K chars, SQL injection, XSS, Unicode edge cases
2. STATE VIOLATIONS (3-5 tests): wrong-order actions, mid-operation navigation, double-submit
3. CONCURRENCY (2-3 tests): rapid-fire clicks, parallel operations
4. ERROR RECOVERY (2-3 tests): network failures, backend errors
5. AUTH EDGE CASES (2-3 tests): expired sessions, cleared cookies

Rules:
- Write valid Playwright TypeScript tests
- Use import { test, expect } from '@playwright/test'
- Each test should be self-contained (navigate, act, assert)
- Use test.slow() for tests that involve async operations
- Assert that the app does NOT crash — check for error messages, console errors
- Write to a single file: tests/e2e/adversarial.spec.ts

${context.knownBugs.length > 0 ? `Known bugs (do NOT re-test): ${context.knownBugs.join(', ')}` : ''}`;
}
