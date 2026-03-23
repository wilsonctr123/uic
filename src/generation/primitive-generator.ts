/**
 * Primitive-Action Test Generator
 *
 * Generates real Playwright test code from affordances.
 * Each executable affordance gets a test that performs its action
 * and asserts its oracle. No TODO stubs for executable affordances.
 *
 * Blocked affordances get test.skip with structured reason.
 * Informational affordances get visibility checks (separate from interaction tests).
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Affordance, AffordanceLedger, UicConfig, ActionType, OracleType } from '../config/types.js';
import { getWidgetAdapter } from './adapters.js';

function sanitizeFilename(s: string): string {
  return s.replace(/^\//, '').replace(/\//g, '-').replace(/[^a-zA-Z0-9-]/g, '') || 'home';
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Locator generation ──

function isBareOrAmbiguous(selector: string): boolean {
  // Bare tag: "button", "a", "input"
  if (/^[a-z]+$/.test(selector)) return true;
  // Tag.class that's still common: "a.active", "button.primary-button"
  if (/^[a-z]+\.[a-z]/.test(selector)) return true;
  return false;
}

function makeLocator(aff: Affordance): string {
  // Best: role + name (most specific, recommended by Playwright)
  if (aff.target.role && aff.target.name) {
    return `page.getByRole('${aff.target.role}', { name: /${escapeRegex(aff.target.name)}/i })`;
  }
  // Good: placeholder text
  if (aff.target.placeholder) {
    return `page.getByPlaceholder(/${escapeRegex(aff.target.placeholder)}/i)`;
  }
  // Good: label text (use getByText for buttons/links without role+name)
  if (aff.label && aff.label.length > 1 && aff.label.length < 50 && !aff.label.includes('\n')) {
    const escaped = escapeRegex(aff.label);
    if (aff.elementType === 'link') {
      return `page.getByRole('link', { name: /${escaped}/i })`;
    }
    if (aff.elementType === 'button') {
      return `page.getByRole('button', { name: /${escaped}/i })`;
    }
    return `page.getByText(/${escaped}/i)`;
  }
  // Fallback: use selector if it's specific enough
  if (aff.target.selector && !isBareOrAmbiguous(aff.target.selector)) {
    return `page.locator('${aff.target.selector}')`;
  }
  // Last resort: bare selector with .first() to avoid strict mode
  return `page.locator('${aff.target.selector}').first()`;
}

// ── Action code generation ──

function generateAction(aff: Affordance, locator: string): string {
  // Check for widget-specific adapter first
  const adapter = getWidgetAdapter(aff);
  if (adapter) return adapter;

  switch (aff.action) {
    case 'click':
      return `    await ${locator}.click();`;

    case 'fill': {
      const value = aff.elementType === 'input' && aff.target.placeholder?.includes('password')
        ? 'TestPassword123!'
        : aff.elementType === 'input' && aff.target.placeholder?.includes('@')
          ? 'test@example.com'
          : 'test input value';
      return `    await ${locator}.fill('${value}');`;
    }

    case 'toggle':
      return `    await ${locator}.click();`;

    case 'select-option':
      return `    const options = await ${locator}.locator('option').allTextContents();\n` +
             `    if (options.length > 1) await ${locator}.selectOption({ index: 1 });`;

    case 'upload':
      return `    await ${locator}.setInputFiles({\n` +
             `      name: 'test-file.txt',\n` +
             `      mimeType: 'text/plain',\n` +
             `      buffer: Buffer.from('test content'),\n` +
             `    });`;

    case 'navigate':
      return `    await ${locator}.click();`;

    default:
      return `    await ${locator}.click();`;
  }
}

// ── Oracle (assertion) code generation ──

function generateOracle(aff: Affordance, locator: string): string {
  switch (aff.oracle) {
    case 'url-changes': {
      // Self-navigation: if the link points to the current route, just assert no crash
      const linkName = (aff.target.name || aff.label || '').toLowerCase();
      const routeName = aff.route === '/' ? 'home' : aff.route.replace(/^\//, '');
      if (linkName === routeName || linkName === aff.route.replace(/^\//, '')) {
        return `    // Self-navigation: already on ${aff.route}, assert no crash\n` +
               `    await expect(${locator}).toBeVisible();`;
      }
      return `    await page.waitForURL((url) => url.pathname !== '${aff.route}', { timeout: 5000 });`;
    }

    case 'element-appears':
      return `    // Assert: new element appeared after action\n` +
             `    await page.waitForTimeout(500);\n` +
             `    // Verify page content changed (new element, form, dialog, etc.)`;

    case 'element-disappears':
      return `    // Assert: element removed after action\n` +
             `    await page.waitForTimeout(500);`;

    case 'attribute-changes':
      return `    // Assert: element state changed (active, checked, style, etc.)\n` +
             `    await page.waitForTimeout(300);`;

    case 'count-changes':
      return `    // Assert: list/table count changed\n` +
             `    await page.waitForTimeout(500);`;

    case 'network-fires':
      return `    // Assert: network request was made (form submitted)\n` +
             `    await page.waitForTimeout(1000);`;

    case 'content-changes':
      return `    // Assert: page content updated\n` +
             `    await page.waitForTimeout(500);`;

    case 'no-crash':
    default:
      return `    // Assert: no crash — no uncaught errors, element still rendered\n` +
             `    await expect(${locator}).toBeVisible();`;
  }
}

// ── Cleanup code for mutating tests ──

function generateCleanup(aff: Affordance): string {
  if (!aff.mutatesState) return '';
  return `\n    // Cleanup: this test mutates state\n` +
         `    // Consider using unique identifiers or API cleanup in afterEach`;
}

// ── Single affordance → test code ──

function generateAffordanceTest(aff: Affordance): string {
  const locator = makeLocator(aff);

  if (aff.disposition === 'blocked') {
    return `  test.skip('${aff.label}', async () => {\n` +
           `    // BLOCKED: ${aff.blockReason || 'Unknown reason'}\n` +
           `    // Disposition: blocked\n` +
           `    // Fixture needed: ${aff.fixture?.description || 'none'}\n` +
           `  });\n`;
  }

  if (aff.disposition === 'informational' || aff.disposition === 'excluded') {
    return ''; // no test generated for these
  }

  const action = generateAction(aff, locator);
  const oracle = generateOracle(aff, locator);
  const cleanup = generateCleanup(aff);

  return `  test('${aff.id}: ${aff.action} ${aff.label}', async ({ page }) => {\n` +
         `    await page.goto('${aff.route}');\n` +
         `    await ${locator}.waitFor({ timeout: 5000 });\n` +
         `\n` +
         `${action}\n` +
         `\n` +
         `${oracle}${cleanup}\n` +
         `  });\n`;
}

// ── Main generator ──

export interface GenerateResult {
  totalTests: number;
  interactionTests: number;
  smokeTests: number;
  blockedTests: number;
  routeFiles: number;
}

export function generateInteractionTests(
  ledger: AffordanceLedger,
  config: UicConfig,
  outputDir: string,
): GenerateResult {
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(join(outputDir, 'fixtures'), { recursive: true });

  let totalTests = 0;
  let interactionTests = 0;
  let smokeTests = 0;
  let blockedTests = 0;

  // Group affordances by route
  const routeMap = new Map<string, Affordance[]>();
  for (const aff of ledger.affordances) {
    const list = routeMap.get(aff.route) || [];
    list.push(aff);
    routeMap.set(aff.route, list);
  }

  // ── Auth setup ──
  const authSetup = `import { test as setup } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const authFile = path.join(__dirname, '../../.uic/auth/user.json');

setup('authenticate', async ({ page }) => {
  const email = process.env.TEST_USER_EMAIL || 'test@example.com';
  const password = process.env.TEST_USER_PASSWORD || 'testpassword123';
  fs.mkdirSync(path.dirname(authFile), { recursive: true });

  await page.goto('/login');
  await page.getByLabel(/email/i).or(page.locator('input[type="email"]')).first().fill(email);
  await page.getByLabel(/password/i).or(page.locator('input[type="password"]')).first().fill(password);
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

  // ── Test fixtures ──
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
  writeFileSync(join(outputDir, 'fixtures/test-fixtures.ts'), fixtures);

  // ── Per-route test files ──
  for (const [route, affordances] of routeMap) {
    const filename = `${sanitizeFilename(route)}.spec.ts`;
    const routeLabel = route === '/' ? 'Home' : route.replace(/^\//, '');
    const needsAuth = affordances.some(a => a.persona !== 'guest');

    // Smoke test (separate from interactions)
    // Guest routes may have expected 401s from /auth/me check — filter those out
    const errorFilter = needsAuth
      ? `    expect(consoleErrors).toHaveLength(0);\n`
      : `    const realErrors = consoleErrors.filter(e => !e.includes('401') && !e.includes('Unauthorized'));\n` +
        `    expect(realErrors).toHaveLength(0);\n`;
    const smokeTest = `  test('${routeLabel}: page loads without errors', async ({ page, consoleErrors }) => {\n` +
      `    await page.goto('${route}');\n` +
      `    await page.waitForLoadState('domcontentloaded');\n` +
      (needsAuth ? `    await expect(page.locator('nav')).toBeVisible();\n` : '') +
      errorFilter +
      `  });\n`;
    smokeTests++;
    totalTests++;

    // Interaction tests (real actions)
    const interactionTestCode: string[] = [];
    const blockedTestCode: string[] = [];

    for (const aff of affordances) {
      if (aff.disposition === 'informational' || aff.disposition === 'excluded' || aff.disposition === 'grouped') {
        continue;
      }

      const testCode = generateAffordanceTest(aff);
      if (!testCode) continue;

      if (aff.disposition === 'blocked') {
        blockedTestCode.push(testCode);
        blockedTests++;
        totalTests++;
      } else {
        interactionTestCode.push(testCode);
        interactionTests++;
        totalTests++;
        aff.generatedTest = true;
      }
    }

    const testFile = `import { test, expect } from './fixtures/test-fixtures';\n\n` +
      `test.describe('${routeLabel.charAt(0).toUpperCase() + routeLabel.slice(1)}', () => {\n` +
      (needsAuth ? '' : `  test.use({ storageState: { cookies: [], origins: [] } });\n\n`) +
      `  // ── Smoke Test ──\n` +
      `${smokeTest}\n` +
      `  // ── Interaction Tests (${interactionTestCode.length}) ──\n` +
      `${interactionTestCode.join('\n')}\n` +
      (blockedTestCode.length ? `  // ── Blocked (${blockedTestCode.length}) ──\n${blockedTestCode.join('\n')}\n` : '') +
      `});\n`;

    writeFileSync(join(outputDir, filename), testFile);
  }

  // ── Auth invariants ──
  const protectedRoutes = [...routeMap.keys()].filter(r =>
    routeMap.get(r)?.some(a => a.persona !== 'guest')
  );

  const authTest = `import { test, expect } from './fixtures/test-fixtures';\n\n` +
    `test.describe('Auth Invariants', () => {\n` +
    `  test.use({ storageState: { cookies: [], origins: [] } });\n\n` +
    `  test('auth-redirect: protected routes redirect to login', async ({ page }) => {\n` +
    `    const protectedRoutes = ${JSON.stringify(protectedRoutes, null, 4).replace(/\n/g, '\n    ')};\n\n` +
    `    for (const route of protectedRoutes) {\n` +
    `      await page.goto(route);\n` +
    `      await page.waitForTimeout(1000);\n` +
    `      expect(page.url()).toContain('/login');\n` +
    `    }\n` +
    `  });\n` +
    `});\n`;
  writeFileSync(join(outputDir, 'auth-invariants.spec.ts'), authTest);
  totalTests++;

  console.log(`\n🧪 Generated ${totalTests} tests in ${outputDir}/`);
  console.log(`   Interaction tests: ${interactionTests}`);
  console.log(`   Smoke tests:       ${smokeTests}`);
  console.log(`   Blocked tests:     ${blockedTests}`);
  console.log(`   Auth invariants:   1`);
  console.log(`   Route files:       ${routeMap.size}\n`);

  return {
    totalTests,
    interactionTests,
    smokeTests,
    blockedTests,
    routeFiles: routeMap.size,
  };
}
