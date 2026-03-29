import type { InteractionObservation, OracleType } from '../config/types.js';

/**
 * Generate Playwright wait code from observation data.
 * Returns a string of TypeScript code to insert into generated tests.
 */
export function generateWaitCode(
  observation: InteractionObservation | undefined,
  fallbackOracle: OracleType,
  indent: string = '    ',
  route?: string,
): string {
  if (observation) {
    // Observation-based: use real data to generate precise waits

    // Check for DOM mutations with added nodes
    const addedMutation = observation.mutations.find(m => m.addedCount > 0);
    if (addedMutation) {
      const timeout = observation.settleTime + 2000;
      return `${indent}await page.waitForSelector('${escapeQuotes(addedMutation.targetSelector)}', { timeout: ${timeout} });`;
    }

    // Check for network requests
    if (observation.networkRequests.length > 0) {
      const urlPattern = extractUrlPattern(observation.networkRequests[0].url);
      return `${indent}await page.waitForResponse(resp => resp.url().includes('${escapeQuotes(urlPattern)}'));`;
    }

    // Check for URL change
    if (observation.urlChanged && observation.newUrl) {
      const escapedPattern = escapeRegex(observation.newUrl);
      return `${indent}await page.waitForURL(/${escapedPattern}/);`;
    }
  }

  // No observation — fall back by oracle type
  switch (fallbackOracle) {
    case 'url-changes': {
      const urlPattern = route ? route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '.*';
      return `${indent}await page.waitForURL(/${urlPattern}/, { timeout: 5000 });`;
    }

    case 'element-appears':
      return `${indent}await page.waitForTimeout(1000); // TODO: run \`uic observe\` for better assertion`;

    case 'network-fires':
      return `${indent}await page.waitForTimeout(1000); // TODO: run \`uic observe\` for better assertion`;

    case 'content-changes':
      return `${indent}await page.waitForTimeout(500); // TODO: run \`uic observe\` for better assertion`;

    case 'no-crash':
      return `${indent}await page.waitForLoadState('domcontentloaded');`;

    default:
      return `${indent}await page.waitForTimeout(500);`;
  }
}

/**
 * Generate code that polls for DOM stability using expect.poll.
 * Waits until no new mutations occur within the polling window.
 */
export function generateSettleWait(timeout: number = 2000): string {
  return [
    `    // Wait for DOM to settle (no mutations for ${timeout}ms)`,
    `    await expect.poll(async () => {`,
    `      const before = await page.evaluate(() => document.body.innerHTML.length);`,
    `      await page.waitForTimeout(${Math.min(timeout, 500)});`,
    `      const after = await page.evaluate(() => document.body.innerHTML.length);`,
    `      return before === after;`,
    `    }, { timeout: ${timeout} }).toBe(true);`,
  ].join('\n');
}

/** Escape single quotes for embedding in template strings */
function escapeQuotes(s: string): string {
  return s.replace(/'/g, "\\'");
}

/** Extract a meaningful URL pattern segment from a full URL */
function extractUrlPattern(url: string): string {
  try {
    const parsed = new URL(url);
    // Use the pathname as the pattern — most stable part
    return parsed.pathname;
  } catch {
    // If URL parsing fails, use the last path segment
    const parts = url.split('/');
    return parts[parts.length - 1] || url;
  }
}

/** Escape special regex characters for embedding in a RegExp literal */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
