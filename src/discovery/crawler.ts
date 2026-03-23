/**
 * Browser-Driven UI Discovery Crawler
 *
 * Crawls a running webapp using Playwright, discovering routes,
 * interactive elements, console errors, and failed requests.
 * Outputs a standardized UIInventory.
 */

import { chromium, type Page, type Browser, type BrowserContext } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { UicConfig, UIInventory, DiscoveredRoute, DiscoveredElement, ElementClassification } from '../config/types.js';
import { getArtifactPaths } from '../config/loader.js';
import { classifyElement } from './element-classifier.js';

export interface CrawlerOptions {
  config: UicConfig;
  projectRoot: string;
  authenticatedContext?: BrowserContext;
}

/**
 * Discover all interactive elements on a page.
 */
async function discoverPageElements(page: Page): Promise<DiscoveredElement[]> {
  return page.evaluate(() => {
    const elements: any[] = [];
    const selectors = [
      'button', 'a[href]', 'input', 'textarea', 'select',
      '[role="button"]', '[role="tab"]', '[role="checkbox"]',
      '[role="switch"]', '[role="dialog"]', '[role="menu"]',
      '[role="menuitem"]', '[role="link"]', '[role="searchbox"]',
      '[role="combobox"]', '[role="listbox"]',
      'table', 'form', '[data-testid]',
      '[type="file"]', '[contenteditable="true"]',
    ];

    const seen = new Set<Element>();
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (seen.has(el)) continue;
        seen.add(el);

        const rect = el.getBoundingClientRect();
        const isVisible = rect.width > 0 && rect.height > 0 &&
          getComputedStyle(el).display !== 'none' &&
          getComputedStyle(el).visibility !== 'hidden';

        const tag = el.tagName.toLowerCase();
        const entry: any = {
          tag,
          role: el.getAttribute('role') || undefined,
          label: el.getAttribute('aria-label') ||
                 (el as HTMLInputElement).labels?.[0]?.textContent?.trim() ||
                 undefined,
          text: (el.textContent || '').trim().substring(0, 100) || undefined,
          name: el.getAttribute('name') || undefined,
          placeholder: el.getAttribute('placeholder') || undefined,
          disabled: (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true',
          visible: isVisible,
          testId: el.getAttribute('data-testid') || undefined,
          selector: '',
        };

        if (tag === 'input' || tag === 'textarea' || tag === 'select') {
          entry.type = (el as HTMLInputElement).type || tag;
        }
        if (tag === 'a') {
          entry.href = el.getAttribute('href') || undefined;
        }

        // Build best selector
        if (entry.testId) {
          entry.selector = `[data-testid="${entry.testId}"]`;
        } else if (entry.role && entry.label) {
          entry.selector = `role=${entry.role}[name="${entry.label}"]`;
        } else if (entry.role && entry.text) {
          entry.selector = `role=${entry.role}[name="${entry.text.substring(0, 50)}"]`;
        } else if (tag === 'input' && entry.name) {
          entry.selector = `input[name="${entry.name}"]`;
        } else if (tag === 'input' && entry.placeholder) {
          entry.selector = `input[placeholder="${entry.placeholder}"]`;
        } else {
          const id = el.id ? `#${el.id}` : '';
          const cls = el.className && typeof el.className === 'string'
            ? '.' + el.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.')
            : '';
          entry.selector = `${tag}${id}${cls}`;
        }

        elements.push(entry);
      }
    }
    return elements;
  });
}

/**
 * Crawl a single route and collect discovery data.
 */
async function crawlRoute(
  page: Page,
  baseUrl: string,
  routePath: string,
  requiresAuth: boolean,
  config: UicConfig,
  screenshotDir: string,
): Promise<DiscoveredRoute> {
  const consoleErrors: string[] = [];
  const failedRequests: { url: string; status: number; method: string }[] = [];
  const notes: string[] = [];

  const onConsole = (msg: any) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  };
  const onResponse = (resp: any) => {
    if (resp.status() >= 400 && !resp.url().includes('/auth/me')) {
      failedRequests.push({ url: resp.url(), status: resp.status(), method: resp.request().method() });
    }
  };
  page.on('console', onConsole);
  page.on('response', onResponse);

  try {
    const url = `${baseUrl}${routePath}`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(config.discovery.waitAfterNavigation || 1000);

    // Check for auth redirect
    const currentPath = new URL(page.url()).pathname;
    if (currentPath !== routePath && (currentPath.startsWith('/login') || currentPath.startsWith('/signin'))) {
      notes.push(`Redirected to ${currentPath} — auth required but not authenticated`);
    }

    // Screenshot
    let screenshotPath: string | undefined;
    if (config.discovery.screenshots !== false) {
      const screenshotName = routePath.replace(/\//g, '_').replace(/^_/, '') || 'home';
      screenshotPath = `${screenshotDir}/${screenshotName}.png`;
      mkdirSync(dirname(screenshotPath), { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: true });
    }

    // Discover elements
    const rawElements = await discoverPageElements(page);
    const elements: DiscoveredElement[] = rawElements.map(el => ({
      ...el,
      classification: classifyElement(el),
    }));

    const title = await page.title();

    return {
      path: routePath,
      url: page.url(),
      title,
      requiresAuth,
      screenshot: screenshotPath,
      elements,
      consoleErrors,
      failedRequests,
      confidence: currentPath === routePath ? 'high' : 'low',
      discoveredAt: new Date().toISOString(),
      notes,
    };
  } catch (e) {
    notes.push(`Error during discovery: ${(e as Error).message}`);
    return {
      path: routePath,
      url: `${baseUrl}${routePath}`,
      title: '',
      requiresAuth,
      elements: [],
      consoleErrors,
      failedRequests,
      confidence: 'low',
      discoveredAt: new Date().toISOString(),
      notes,
    };
  } finally {
    page.off('console', onConsole);
    page.off('response', onResponse);
  }
}

/**
 * Run full UI discovery against a running application.
 */
export async function discover(options: CrawlerOptions): Promise<UIInventory> {
  const { config, projectRoot } = options;
  const paths = getArtifactPaths(projectRoot, config);
  const baseUrl = config.app.baseUrl;

  console.log(`\n🔍 UIC Discovery — ${baseUrl}\n`);

  const browser = await chromium.launch({ headless: true });
  const context = options.authenticatedContext || await browser.newContext({
    viewport: {
      width: config.discovery.viewportWidth || 1440,
      height: config.discovery.viewportHeight || 900,
    },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  const routes: DiscoveredRoute[] = [];
  const excludeSet = new Set(config.discovery.excludeRoutes || []);

  for (const routePath of config.discovery.seedRoutes) {
    if (excludeSet.has(routePath)) {
      console.log(`  Skipping ${routePath} (excluded)`);
      continue;
    }

    const requiresAuth = routePath !== '/login' && routePath !== '/forgot-password' && routePath !== '/reset-password';
    console.log(`  Crawling ${routePath}...`);
    const discovered = await crawlRoute(page, baseUrl, routePath, requiresAuth, config, paths.screenshotDir);
    routes.push(discovered);
  }

  await browser.close();

  // Build inventory
  const allElements = routes.flatMap(r => r.elements);
  const inventory: UIInventory = {
    appName: config.app.name,
    baseUrl,
    discoveredAt: new Date().toISOString(),
    discoveryMethod: 'browser-crawl',
    config: {
      framework: config.app.framework,
      authStrategy: config.auth?.strategy,
    },
    routes,
    summary: {
      totalRoutes: routes.length,
      totalElements: allElements.length,
      totalButtons: allElements.filter(e => e.classification === 'button').length,
      totalInputs: allElements.filter(e => ['text-input', 'password-input', 'email-input', 'search-input', 'textarea', 'select', 'date-input'].includes(e.classification)).length,
      totalLinks: allElements.filter(e => e.classification === 'link').length,
      totalTables: allElements.filter(e => e.classification === 'table').length,
      totalDialogs: allElements.filter(e => e.classification === 'dialog').length,
      authRequired: routes.filter(r => r.requiresAuth).length,
      authNotRequired: routes.filter(r => !r.requiresAuth).length,
      consoleErrorCount: routes.reduce((n, r) => n + r.consoleErrors.length, 0),
      failedRequestCount: routes.reduce((n, r) => n + r.failedRequests.length, 0),
    },
  };

  // Write inventory
  mkdirSync(dirname(paths.inventory), { recursive: true });
  writeFileSync(paths.inventory, JSON.stringify(inventory, null, 2));
  console.log(`\n✅ Discovery complete → ${paths.inventory}`);
  console.log(`   Routes: ${inventory.summary.totalRoutes}`);
  console.log(`   Elements: ${inventory.summary.totalElements}`);
  console.log(`   Buttons: ${inventory.summary.totalButtons}`);
  console.log(`   Inputs: ${inventory.summary.totalInputs}`);
  console.log(`   Links: ${inventory.summary.totalLinks}\n`);

  // ── Degraded discovery detection ──
  const seedCount = config.discovery.seedRoutes.length;
  const lowConfidence = routes.filter(r => r.confidence === 'low');
  const redirected = routes.filter(r => r.notes.some(n => n.includes('Redirected to')));
  const authRoutes = routes.filter(r => r.requiresAuth);
  const avgElements = routes.length > 0 ? allElements.length / routes.length : 0;

  const warnings: string[] = [];

  if (redirected.length > 0 && redirected.length >= authRoutes.length * 0.5) {
    warnings.push(`${redirected.length} of ${authRoutes.length} auth-required routes redirected to login — credentials missing or invalid`);
  }

  if (lowConfidence.length > seedCount * 0.5) {
    warnings.push(`${lowConfidence.length} of ${seedCount} seed routes have low confidence — most pages not reachable`);
  }

  if (seedCount > 3 && allElements.length < seedCount * 5) {
    warnings.push(`Only ${allElements.length} elements found across ${seedCount} routes — expected ${seedCount * 10}+ for a real app`);
  }

  if (warnings.length > 0) {
    console.log('⚠️  DEGRADED DISCOVERY DETECTED\n');
    for (const w of warnings) {
      console.log(`   ⚠ ${w}`);
    }
    console.log('');
    console.log('   This will produce low-quality tests. To fix:');
    console.log('   1. Create .env with TEST_USER_EMAIL and TEST_USER_PASSWORD');
    console.log('   2. Ensure backend is running (check startCommand in uic.config.ts)');
    console.log('   3. Re-run: /uic-discover\n');
  }

  return inventory;
}
