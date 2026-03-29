/**
 * Persona Auth Abstraction
 *
 * Provides a unified interface for authenticating as different personas
 * (guest, user, admin) across different auth strategies.
 */

import { type BrowserContext, type Page, chromium } from 'playwright';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { AuthConfig, PersonaConfig } from '../config/types.js';

/**
 * Check whether a URL matches any of the configured login page patterns.
 */
function isLoginPage(url: string, authConfig: AuthConfig): boolean {
  const patterns = authConfig.loginPatterns || ['/login', '/signin', '/auth'];
  return patterns.some(p => url.includes(p));
}

export interface AuthResult {
  context: BrowserContext;
  persona: string;
  success: boolean;
  error?: string;
  /** Serialized cookie header for API calls (e.g., seeding) */
  cookie?: string;
}

/**
 * Extract cookies from a browser context as a Cookie header string.
 */
async function extractCookieHeader(context: BrowserContext, baseUrl: string): Promise<string> {
  try {
    const url = new URL(baseUrl);
    const cookies = await context.cookies(url.origin);
    return cookies.map(c => `${c.name}=${c.value}`).join('; ');
  } catch {
    return '';
  }
}

/**
 * Authenticate as a given persona using the configured strategy.
 */
export async function authenticatePersona(
  baseUrl: string,
  persona: string,
  authConfig: AuthConfig,
  authDir: string,
): Promise<AuthResult> {
  const personaConfig = authConfig.personas?.[persona];
  if (!personaConfig && persona !== 'guest') {
    return {
      context: await createFreshContext(),
      persona,
      success: false,
      error: `No persona config found for "${persona}"`,
    };
  }

  if (persona === 'guest') {
    return {
      context: await createFreshContext(),
      persona: 'guest',
      success: true,
    };
  }

  switch (authConfig.strategy) {
    case 'storage-state':
      return storageStateAuth(baseUrl, persona, personaConfig!, authDir);
    case 'ui-flow':
      return uiFlowAuth(baseUrl, persona, personaConfig!, authConfig, authDir);
    case 'api-bootstrap':
      return apiBootstrapAuth(baseUrl, persona, personaConfig!, authConfig, authDir);
    case 'custom':
      return customAuth(baseUrl, persona, personaConfig!, authConfig, authDir);
    default:
      return {
        context: await createFreshContext(),
        persona,
        success: false,
        error: `Unknown auth strategy: ${authConfig.strategy}`,
      };
  }
}

async function createFreshContext(): Promise<BrowserContext> {
  const browser = await chromium.launch({ headless: true });
  return browser.newContext({ ignoreHTTPSErrors: true });
}

/**
 * Strategy: Import saved browser storage state (cookies, localStorage).
 */
async function storageStateAuth(
  baseUrl: string,
  persona: string,
  config: PersonaConfig,
  authDir: string,
): Promise<AuthResult> {
  const statePath = config.storageStatePath || join(authDir, `${persona}.json`);

  if (!existsSync(statePath)) {
    return {
      context: await createFreshContext(),
      persona,
      success: false,
      error: `Storage state file not found: ${statePath}. Run auth setup first.`,
    };
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: statePath,
    ignoreHTTPSErrors: true,
  });

  return { context, persona, success: true, cookie: await extractCookieHeader(context, baseUrl) };
}

/**
 * Strategy: Drive the login UI once and cache the resulting state.
 */
async function uiFlowAuth(
  baseUrl: string,
  persona: string,
  config: PersonaConfig,
  authConfig: AuthConfig,
  authDir: string,
): Promise<AuthResult> {
  const cachedStatePath = join(authDir, `${persona}.json`);

  // Try cached state first
  if (existsSync(cachedStatePath)) {
    try {
      const browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        storageState: cachedStatePath,
        ignoreHTTPSErrors: true,
      });
      // Verify the session is still valid
      const page = await context.newPage();
      const resp = await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 10000 });
      if (!isLoginPage(page.url(), authConfig)) {
        await page.close();
        return { context, persona, success: true, cookie: await extractCookieHeader(context, baseUrl) };
      }
      await context.close();
      await browser.close();
    } catch { /* cache invalid, re-authenticate */ }
  }

  // Drive login UI
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  try {
    if (config.loginSteps) {
      // Custom login steps
      for (const step of config.loginSteps) {
        switch (step.action) {
          case 'goto':
            await page.goto(step.url || `${baseUrl}${authConfig.loginPatterns?.[0] || '/login'}`, { waitUntil: 'domcontentloaded' });
            break;
          case 'fill':
            await page.locator(step.selector!).fill(step.value || '');
            break;
          case 'click':
            await page.locator(step.selector!).click();
            break;
          case 'wait':
            await page.waitForTimeout(step.timeout || 1000);
            break;
        }
      }
    } else {
      // Default: standard email/password form
      await page.goto(`${baseUrl}${authConfig.loginPatterns?.[0] || '/login'}`, { waitUntil: 'domcontentloaded' });

      // Fill email — try role-based first, fall back to common selectors
      const emailField = page.getByLabel(/email/i).or(page.locator('input[type="email"]')).or(page.locator('#login-email'));
      await emailField.first().fill(config.email || '');

      // Fill password — password inputs don't have role=textbox, use label or type selector
      const passwordField = page.getByLabel(/password/i).or(page.locator('input[type="password"]')).or(page.locator('#login-password'));
      await passwordField.first().fill(config.password || '');

      // Click submit
      const submitPattern = authConfig.submitButtonPattern
        ? new RegExp(authConfig.submitButtonPattern, 'i')
        : /sign in|log in|submit|continue|enter/i;
      await page.getByRole('button', { name: submitPattern }).click();
      await page.waitForTimeout(3000);
    }

    // Check if login succeeded
    if (isLoginPage(page.url(), authConfig)) {
      await page.close();
      return { context, persona, success: false, error: 'Login failed — still on login page' };
    }

    // Cache the state
    mkdirSync(dirname(cachedStatePath), { recursive: true });
    await context.storageState({ path: cachedStatePath });
    await page.close();

    return { context, persona, success: true, cookie: await extractCookieHeader(context, baseUrl) };
  } catch (err) {
    await page.close();
    return { context, persona, success: false, error: `UI flow auth failed: ${(err as Error).message}` };
  }
}

/**
 * Strategy: Authenticate via API call, then inject browser state.
 */
async function apiBootstrapAuth(
  baseUrl: string,
  persona: string,
  config: PersonaConfig,
  authConfig: AuthConfig,
  authDir: string,
): Promise<AuthResult> {
  const cachedStatePath = join(authDir, `${persona}.json`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  try {
    const endpoint = config.loginEndpoint || '/api/auth/login';
    const loginData = {
      email: config.email,
      password: config.password,
      ...config.loginData,
    };

    const response = await page.request.post(`${baseUrl}${endpoint}`, {
      data: loginData,
    });

    if (!response.ok()) {
      if (config.signupEndpoint) {
        // Try signup as fallback only if configured
        const signupBody = config.signupBody || { email: config.email, password: config.password };
        const signupResp = await page.request.post(`${baseUrl}${config.signupEndpoint}`, {
          data: signupBody,
        });

        if (signupResp.ok()) {
          // Retry login
          const retryResp = await page.request.post(`${baseUrl}${endpoint}`, { data: loginData });
          if (!retryResp.ok()) {
            await page.close();
            return { context, persona, success: false, error: `API login failed: ${retryResp.status()}` };
          }
        } else {
          await page.close();
          return { context, persona, success: false, error: `API login failed: ${response.status()}` };
        }
      } else {
        await page.close();
        return { context, persona, success: false, error: `API login failed: ${response.status()}` };
      }
    }

    // Navigate to verify and capture full state
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 10000 });

    // Verify we actually landed on an authenticated page (not still on login)
    const finalUrl = page.url();
    const authPaths = ['/login', '/signin', '/sign-in', '/auth', '/register', '/signup'];
    const stillOnAuth = authPaths.some(p => new URL(finalUrl).pathname.startsWith(p));
    if (stillOnAuth) {
      await page.close();
      return { context, persona, success: false, error: `Auth failed: still on ${new URL(finalUrl).pathname} after login` };
    }

    // Cache state
    mkdirSync(dirname(cachedStatePath), { recursive: true });
    await context.storageState({ path: cachedStatePath });
    await page.close();

    return { context, persona, success: true, cookie: await extractCookieHeader(context, baseUrl) };
  } catch (err) {
    await page.close();
    return { context, persona, success: false, error: `API bootstrap failed: ${(err as Error).message}` };
  }
}

/**
 * Strategy: Custom auth hook provided by the consumer.
 */
async function customAuth(
  baseUrl: string,
  persona: string,
  config: PersonaConfig,
  authConfig: AuthConfig,
  authDir: string,
): Promise<AuthResult> {
  if (!authConfig.customHook) {
    return {
      context: await createFreshContext(),
      persona,
      success: false,
      error: 'Custom auth strategy requires a customHook path in config',
    };
  }

  try {
    const hookModule = await import(authConfig.customHook);
    const hookFn = hookModule.default || hookModule.authenticate;
    return await hookFn({ baseUrl, persona, config, authDir });
  } catch (err) {
    return {
      context: await createFreshContext(),
      persona,
      success: false,
      error: `Custom auth hook failed: ${(err as Error).message}`,
    };
  }
}
