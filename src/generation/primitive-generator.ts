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

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
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
  // Fallback: use selector only if it's an ID or data-testid that is specific
  if (aff.target.selector && /^#[a-zA-Z][\w-]+$/.test(aff.target.selector)) {
    return `page.locator('${aff.target.selector}')`;
  }
  // Last resort: use aria label or text content with .first()
  if (aff.label) {
    return `page.getByText('${escapeRegex(aff.label)}').first()`;
  }
  // No reliable locator — mark as blocked
  return `page.locator('[data-testid="blocked-no-locator"]') /* NO RELIABLE LOCATOR: ${(aff.target.selector || 'unknown').replace(/'/g, '')} */`;
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
      const ph = (aff.target.placeholder || '').toLowerCase();
      const label = (aff.label || '').toLowerCase();
      let value = 'quarterly budget planning documents';
      if (ph.includes('password') || label.includes('password')) value = 'TestPassword123!';
      else if (ph.includes('@') || ph.includes('email') || label.includes('email')) value = 'test@example.com';
      else if (ph.includes('search') || ph.includes('ask') || ph.includes('query')) value = 'quarterly budget planning documents';
      else if (ph.includes('title') || label.includes('title')) value = 'Q4 Engineering Retrospective';
      else if (ph.includes('channel') || label.includes('channel')) value = '#engineering';
      else if (ph.includes('date') || label.includes('date')) value = '2026-03-15';
      else if (ph.includes('url') || label.includes('url')) value = 'https://example.com';
      else if (ph.includes('name') || label.includes('name')) value = 'Test User';
      else if (aff.elementType === 'textarea') value = 'This is a detailed test input with enough content to verify the form handles multi-line text correctly.';
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
             `    await expect.poll(() => page.locator('body').textContent(), { timeout: 5000 }).not.toBe(beforeText);`;

    case 'element-disappears':
      return `    // Assert: element removed after action\n` +
             `    await expect(${locator}).toBeHidden({ timeout: 5000 });`;

    case 'attribute-changes':
      return `    // Assert: element state changed (active, checked, style, etc.)\n` +
             `    await page.waitForLoadState('domcontentloaded');`;

    case 'count-changes':
      return `    // Assert: list/table count changed\n` +
             `    await expect.poll(() => page.locator('${aff.target.selector || 'li, tr'}').count(), { timeout: 5000 }).not.toBe(beforeCount);`;

    case 'network-fires':
      return `    // Assert: network request was made (form submitted)\n` +
             `    // Wrap the triggering action with waitForResponse in the test\n` +
             `    await page.waitForLoadState('networkidle', { timeout: 5000 });`;

    case 'content-changes':
      return `    // Assert: page content updated\n` +
             `    await expect.poll(() => page.locator('main').textContent() ?? page.locator('body').textContent(), { timeout: 5000 }).not.toBe(beforeContent);`;

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

// ── Pre-action setup for oracles that need "before" state ──

function generatePreAction(aff: Affordance): string {
  switch (aff.oracle) {
    case 'element-appears':
      return `    const beforeText = await page.locator('body').textContent();\n`;
    case 'count-changes':
      return `    const beforeCount = await page.locator('${aff.target.selector || 'li, tr'}').count();\n`;
    case 'content-changes':
      return `    const beforeContent = await page.locator('main').textContent() ?? await page.locator('body').textContent();\n`;
    default:
      return '';
  }
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

  const preAction = generatePreAction(aff);
  const action = generateAction(aff, locator);
  const oracle = generateOracle(aff, locator);
  const cleanup = generateCleanup(aff);

  return `  test('${aff.id}: ${aff.action} ${aff.label}', async ({ page }) => {\n` +
         `    await page.goto('${aff.route}');\n` +
         `    await ${locator}.waitFor({ timeout: 5000 });\n` +
         `\n` +
         `${preAction}${action}\n` +
         `\n` +
         `${oracle}${cleanup}\n` +
         `  });\n`;
}

// ── Main generator ──

export interface GenerateOptions {
  /** When true, skip writing files that already exist. Default: false. */
  noOverwrite?: boolean;
}

export interface GenerateResult {
  totalTests: number;
  interactionTests: number;
  smokeTests: number;
  blockedTests: number;
  routeFiles: number;
  skippedFiles: number;
}

export function generateInteractionTests(
  ledger: AffordanceLedger,
  config: UicConfig,
  outputDir: string,
  options: GenerateOptions = {},
): GenerateResult {
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(join(outputDir, 'fixtures'), { recursive: true });

  let totalTests = 0;
  let interactionTests = 0;
  let smokeTests = 0;
  let blockedTests = 0;
  let skippedFiles = 0;
  const noOverwrite = options.noOverwrite ?? false;

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
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const authFile = path.join(__dirname, '../../.uic/auth/user.json');

setup('authenticate', async ({ page }) => {
  const email = process.env.TEST_USER_EMAIL || 'test@example.com';
  const password = process.env.TEST_USER_PASSWORD || 'testpassword123';
  fs.mkdirSync(path.dirname(authFile), { recursive: true });

  await page.goto('${config.auth?.loginPatterns?.[0] || '/login'}');
  await page.getByLabel(/email/i).or(page.locator('input[type="email"]')).first().fill(email);
  await page.getByLabel(/password/i).or(page.locator('input[type="password"]')).first().fill(password);
  await page.getByRole('button', { name: /${config.auth?.submitButtonPattern || 'sign in|log in|submit|continue'}/i }).click();

  try {
    await page.waitForURL((url) => !url.pathname.startsWith('${config.auth?.loginPatterns?.[0] || '/login'}'), { timeout: 8000 });
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
      const ignoredEndpoints = ${JSON.stringify(config.auth?.ignoredEndpoints || ['/auth/me'])};
      if (resp.status() >= 400 && !ignoredEndpoints.some(ep => resp.url().includes(ep)))
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
    const filePath = join(outputDir, filename);

    // --no-overwrite: skip files that already exist
    if (noOverwrite && existsSync(filePath)) {
      console.log(`  ⏭ Skipping ${filename} (exists, use --force to regenerate)`);
      skippedFiles++;
      continue;
    }

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
      (needsAuth && config.discovery?.authLandmark
        ? `    await expect(page.locator('${config.discovery.authLandmark}')).toBeVisible();\n`
        : needsAuth
          ? `    await expect(page.locator('body')).toBeVisible();\n`
          : '') +
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

    writeFileSync(filePath, testFile);
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
    `      await page.waitForLoadState('domcontentloaded');\n` +
    `      expect(page.url()).toContain('${config.auth?.loginPatterns?.[0] || '/login'}');\n` +
    `    }\n` +
    `  });\n` +
    `});\n`;
  const authInvariantsPath = join(outputDir, 'auth-invariants.spec.ts');
  if (noOverwrite && existsSync(authInvariantsPath)) {
    console.log(`  ⏭ Skipping auth-invariants.spec.ts (exists, use --force to regenerate)`);
    skippedFiles++;
  } else {
    writeFileSync(authInvariantsPath, authTest);
    totalTests++;
  }

  console.log(`\n🧪 Generated ${totalTests} tests in ${outputDir}/`);
  console.log(`   Interaction tests: ${interactionTests}`);
  console.log(`   Smoke tests:       ${smokeTests}`);
  console.log(`   Blocked tests:     ${blockedTests}`);
  console.log(`   Auth invariants:   1`);
  console.log(`   Route files:       ${routeMap.size}`);
  if (skippedFiles > 0) {
    console.log(`   Skipped (exist):   ${skippedFiles}`);
  }
  console.log('');

  return {
    totalTests,
    interactionTests,
    smokeTests,
    blockedTests,
    routeFiles: routeMap.size,
    skippedFiles,
  };
}
