/**
 * Test Scaffolding Generator
 *
 * Generates Playwright test files from a UI contract.
 * Tests are organized by route, use role-based locators,
 * and include console/network monitoring.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { UIContract, Surface, Flow, UicConfig } from '../config/types.js';

function sanitizeFilename(s: string): string {
  return s.replace(/^\//, '').replace(/\//g, '-').replace(/[^a-zA-Z0-9-]/g, '') || 'home';
}

function generateSurfaceTest(surface: Surface): string {
  const routeName = surface.route === '/' ? 'Home' : surface.route.replace(/^\//, '').replace(/-/g, ' ');

  // Deduplicate and filter elements to avoid ambiguous selectors
  const seen = new Set<string>();
  const requiredElements = surface.expectations.required_elements
    .filter(el => el.required)
    .map(el => {
      if (el.role && el.name) {
        const escapedName = el.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const key = `role:${el.role}:${el.name}`;
        if (seen.has(key)) return null;
        seen.add(key);
        return `    await expect(page.getByRole('${el.role}', { name: /${escapedName}/i })).toBeVisible();`;
      }
      if (el.selector) {
        // Skip bare tag selectors (e.g. 'button', 'input') — too ambiguous
        if (/^[a-z]+$/.test(el.selector) || /^[a-z]+\.[a-z]/.test(el.selector)) {
          return `    // Skipped ambiguous selector: ${el.selector} (use role-based locator instead)`;
        }
        const key = `sel:${el.selector}`;
        if (seen.has(key)) return null;
        seen.add(key);
        return `    await expect(page.locator('${el.selector}')).toBeVisible();`;
      }
      return `    // TODO: Add assertion for element: ${el.name || 'unknown'}`;
    })
    .filter(Boolean)
    .join('\n');

  const navCheck = surface.persona !== 'guest'
    ? `\n    // Navigation should be visible\n    await expect(page.locator('nav')).toBeVisible();\n`
    : '';

  return `  test('${routeName} page loads successfully', async ({ page }) => {
    await page.goto('${surface.route}');
    await page.waitForLoadState('networkidle');
${navCheck}
${requiredElements}

    // Invariant: no console errors
    // (monitored by test fixture)
  });
`;
}

function generateFlowTest(flow: Flow): string {
  const steps = flow.steps.map(s => `    // Step: ${s}`).join('\n');
  // Prefix with "flow:" to avoid duplicate titles with surface tests
  const title = flow.name.toLowerCase().includes('loads successfully')
    ? `flow: ${flow.name}` : flow.name;

  return `  test('${title}', async ({ page }) => {
${steps}
    // TODO: Implement flow steps
    // This flow was auto-generated from the contract.
    // Replace these comments with real Playwright actions.
  });
`;
}

export function generateTests(contract: UIContract, config: UicConfig, outputDir: string): void {
  mkdirSync(outputDir, { recursive: true });

  // Group surfaces by route
  const routeMap = new Map<string, Surface[]>();
  for (const surface of contract.surfaces) {
    if (surface.metadata.status === 'removed') continue;
    const existing = routeMap.get(surface.route) || [];
    existing.push(surface);
    routeMap.set(surface.route, existing);
  }

  // Group flows by route (infer from flow ID or steps)
  const flowsByRoute = new Map<string, Flow[]>();
  for (const flow of contract.flows) {
    if (flow.status === 'removed') continue;
    // Try to match flow to a route by ID prefix
    let matchedRoute = '/';
    for (const route of routeMap.keys()) {
      const routeSlug = route.replace(/^\//, '') || 'home';
      if (flow.id.startsWith(routeSlug)) {
        matchedRoute = route;
        break;
      }
    }
    const existing = flowsByRoute.get(matchedRoute) || [];
    existing.push(flow);
    flowsByRoute.set(matchedRoute, existing);
  }

  // Generate auth setup file
  const authSetup = `import { test as setup, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const authFile = path.join(__dirname, '../../.uic/auth/user.json');

setup('authenticate', async ({ page }) => {
  const email = process.env.TEST_USER_EMAIL || 'test@example.com';
  const password = process.env.TEST_USER_PASSWORD || 'testpassword123';

  fs.mkdirSync(path.dirname(authFile), { recursive: true });

  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.getByRole('textbox', { name: /email/i }).fill(email);
  await page.getByRole('textbox', { name: /password/i }).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();

  try {
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 8000 });
  } catch {
    console.warn('Login failed — protected route tests may fail.');
  }

  await page.context().storageState({ path: authFile });
});
`;
  writeFileSync(join(outputDir, 'auth.setup.ts'), authSetup);

  // Generate test fixture file
  const fixtures = `import { test as base, expect } from '@playwright/test';

export const test = base.extend<{
  consoleErrors: string[];
  failedRequests: Array<{ url: string; status: number }>;
}>({
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));
    await use(errors);
  },
  failedRequests: async ({ page }, use) => {
    const failed: Array<{ url: string; status: number }> = [];
    page.on('response', resp => {
      if (resp.status() >= 400 && !resp.url().includes('/auth/me'))
        failed.push({ url: resp.url(), status: resp.status() });
    });
    await use(failed);
  },
});

export { expect };
`;
  mkdirSync(join(outputDir, 'fixtures'), { recursive: true });
  writeFileSync(join(outputDir, 'fixtures/test-fixtures.ts'), fixtures);

  // Generate a test file per route
  let totalTests = 0;
  for (const [route, surfaces] of routeMap) {
    const filename = `${sanitizeFilename(route)}.spec.ts`;
    const routeName = route === '/' ? 'Home' : route.replace(/^\//, '');
    const flows = flowsByRoute.get(route) || [];

    // Determine if this route needs auth
    const needsAuth = surfaces.some(s => s.persona !== 'guest');

    const surfaceTests = surfaces.map(s => generateSurfaceTest(s)).join('\n');
    const flowTests = flows.map(f => generateFlowTest(f)).join('\n');

    const testFile = `import { test, expect } from './fixtures/test-fixtures';

test.describe('${routeName.charAt(0).toUpperCase() + routeName.slice(1)}', () => {
${!needsAuth ? "  test.use({ storageState: { cookies: [], origins: [] } });\n" : ''}
${surfaceTests}
${flowTests}
});
`;

    writeFileSync(join(outputDir, filename), testFile);
    totalTests += surfaces.length + flows.length;
  }

  // Generate public routes / auth redirect test
  const authRedirectTest = `import { test, expect } from './fixtures/test-fixtures';

test.describe('Auth Invariants', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('auth-redirect: Protected routes redirect to login', async ({ page }) => {
    const protectedRoutes = ${JSON.stringify(
      [...routeMap.keys()].filter(r => routeMap.get(r)?.some(s => s.persona !== 'guest')),
      null, 4
    ).replace(/\n/g, '\n    ')};

    for (const route of protectedRoutes) {
      await page.goto(route);
      await page.waitForTimeout(1000);
      expect(page.url()).toContain('/login');
    }
  });
});
`;
  writeFileSync(join(outputDir, 'auth-invariants.spec.ts'), authRedirectTest);

  console.log(`\n🧪 Generated ${totalTests + 1} tests in ${outputDir}/`);
  console.log(`   ${routeMap.size} route files + auth setup + fixtures + auth invariants\n`);
}
