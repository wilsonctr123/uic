/**
 * Live DOM Observation Probe
 *
 * Opens a fresh page per InteractionGroup, performs the interaction,
 * records DOM mutations + network requests, and returns an
 * InteractionObservation describing what happened.
 */

import type { BrowserContext, Page } from 'playwright';
import type {
  InteractionGroup,
  InteractionObservation,
  InteractionQualityScore,
  ObservedMutation,
  ObservedRequest,
  OutputZone,
  PrerequisiteResult,
  UicConfig,
} from '../config/types.js';

declare global {
  interface Window {
    __uicMutations?: ObservedMutation[];
  }
}

// ── Test data for different input types ──────────────────────

const TEST_DATA: Record<string, string> = {
  'text-input': 'Hello',
  'email-input': 'test@example.com',
  'search-input': 'test',
  'password-input': 'password123',
  'textarea': 'Test message content',
  'date-input': '2026-01-15',
};

function testValueForSelector(selector: string): string {
  // Try to infer input type from selector
  if (/email/i.test(selector)) return TEST_DATA['email-input'];
  if (/search/i.test(selector)) return TEST_DATA['search-input'];
  if (/password/i.test(selector)) return TEST_DATA['password-input'];
  if (/textarea/i.test(selector)) return TEST_DATA['textarea'];
  if (/date/i.test(selector)) return TEST_DATA['date-input'];
  return TEST_DATA['text-input'];
}

// ── Quality scoring ──────────────────────────────────────────

const ERROR_PATTERNS = /\b(error|failed|exception|denied|forbidden|unavailable|timeout|500|404|403)\b/i;

export function scoreInteractionQuality(
  observation: InteractionObservation,
  attempted: boolean,
): InteractionQualityScore {
  const signals = {
    attempted,
    mutationCount: observation.mutations.length,
    networkRequestCount: observation.networkRequests.length,
    outputChanged: false,
    outputLengthDelta: 0,
    itemCountDelta: 0,
    hasErrorIndicator: false,
    urlChanged: observation.urlChanged,
  };

  if (observation.outputDelta) {
    const { before, after, itemCountBefore, itemCountAfter } = observation.outputDelta;
    signals.outputChanged = before !== after;
    signals.outputLengthDelta = after.length - before.length;
    signals.itemCountDelta = itemCountAfter - itemCountBefore;
    const newContent = after.slice(before.length);
    signals.hasErrorIndicator = ERROR_PATTERNS.test(newContent);
  }

  let score = 0;
  if (!signals.attempted) {
    score = 0;
  } else if (signals.mutationCount === 0 && signals.networkRequestCount === 0 && !signals.urlChanged) {
    score = signals.outputChanged ? 2 : 1;
  } else if (signals.mutationCount > 0 && !signals.outputChanged) {
    score = signals.networkRequestCount > 0 ? 4 : 3;
  } else if (signals.outputChanged && signals.networkRequestCount === 0) {
    score = signals.itemCountDelta !== 0 ? 6 : 5;
  } else if (signals.networkRequestCount > 0 && signals.outputChanged) {
    if (signals.hasErrorIndicator) score = 7;
    else if (signals.outputLengthDelta > 20) score = 10;
    else if (signals.outputLengthDelta > 0) score = 9;
    else score = 8;
  } else if (signals.networkRequestCount > 0) {
    score = 5;
  } else {
    score = 3;
  }

  let band: InteractionQualityScore['band'];
  if (score === 0) band = 'blocked';
  else if (score <= 2) band = 'no-effect';
  else if (score <= 4) band = 'superficial';
  else if (score <= 6) band = 'client-only';
  else if (score <= 8) band = 'real';
  else band = 'verified';

  return { score, band, signals };
}

// ── Prerequisite exploration ─────────────────────────────────

async function explorePrerequisites(
  context: BrowserContext,
  group: InteractionGroup,
  config: UicConfig,
): Promise<PrerequisiteResult | undefined> {
  const maxAttempts = config.observe?.maxPrerequisiteAttempts || 5;

  // Find candidate activation buttons on a fresh page
  const scoutPage = await context.newPage();
  let candidates: Array<{ selector: string; label: string }> = [];

  try {
    await scoutPage.goto(config.app.baseUrl + group.route);
    await scoutPage.waitForLoadState('domcontentloaded');
    await scoutPage.waitForTimeout(500);

    candidates = await scoutPage.evaluate(() => {
      const ACTIVATE = /new|add|create|start|open|show|expand|\+|compose/i;
      const DESTRUCTIVE = /delete|remove|submit|save|confirm|send|cancel|close|logout|sign.?out/i;
      const results: Array<{ selector: string; label: string }> = [];

      const buttons = document.querySelectorAll('button, [role="button"]');
      for (const btn of buttons) {
        const text = (btn as HTMLElement).textContent?.trim() || '';
        if (!text || text.length > 50) continue;
        if (DESTRUCTIVE.test(text)) continue;
        if (!ACTIVATE.test(text)) {
          // Also check aria-expanded="false" or aria-haspopup
          if (btn.getAttribute('aria-expanded') !== 'false' && !btn.hasAttribute('aria-haspopup')) continue;
        }
        // Build a stable selector
        const id = btn.getAttribute('id');
        const testId = btn.getAttribute('data-testid');
        let selector: string;
        if (testId) selector = `[data-testid="${testId}"]`;
        else if (id) selector = `#${id}`;
        else selector = `button:has-text("${text.substring(0, 30)}")`;
        results.push({ selector, label: text.substring(0, 50) });
      }
      return results.slice(0, 10);
    });
  } finally {
    await scoutPage.close();
  }

  if (candidates.length === 0) return undefined;

  // Trial each candidate
  for (const candidate of candidates.slice(0, maxAttempts)) {
    const trialPage = await context.newPage();
    try {
      await trialPage.goto(config.app.baseUrl + group.route);
      await trialPage.waitForLoadState('domcontentloaded');
      await trialPage.waitForTimeout(300);

      // Click the candidate
      await trialPage.locator(candidate.selector).first().click();
      await trialPage.waitForTimeout(500);

      // Check if input members are now visible
      const inputVisible = group.members.inputs.length > 0
        ? await trialPage.locator(group.members.inputs[0]).isVisible().catch(() => false)
        : true;

      if (!inputVisible) continue;

      // Try the original interaction
      const mutations: ObservedMutation[] = [];
      const requests: ObservedRequest[] = [];

      // Install observer
      await trialPage.evaluate(() => {
        (window as any).__uicMutations = [];
        const obs = new MutationObserver(muts => {
          for (const m of muts) {
            (window as any).__uicMutations.push({
              type: m.type,
              targetSelector: '',
              addedCount: m.addedNodes.length,
              removedCount: m.removedNodes.length,
              attributeName: m.attributeName || undefined,
            });
          }
        });
        obs.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
      });

      trialPage.on('response', resp => {
        requests.push({
          url: resp.url(),
          method: resp.request().method(),
          status: resp.status(),
          contentType: resp.headers()['content-type'],
        });
      });

      // Fill inputs
      for (const inputSel of group.members.inputs) {
        const val = testValueForSelector(inputSel);
        await trialPage.locator(inputSel).first().fill(val).catch(() => {});
      }

      // Click trigger or press Enter
      if (group.members.triggers.length > 0) {
        await trialPage.locator(group.members.triggers[0]).first().click().catch(() => {});
      } else if (group.members.inputs.length > 0) {
        await trialPage.locator(group.members.inputs[group.members.inputs.length - 1]).first().press('Enter').catch(() => {});
      }

      // Wait for settle
      await trialPage.waitForTimeout(1500);

      const collectedMutations: ObservedMutation[] = await trialPage.evaluate(() => {
        const raw = (window as any).__uicMutations || [];
        return raw.filter((m: any) => m.type !== 'attributes' || (m.attributeName !== 'class' && m.attributeName !== 'style'));
      });

      if (collectedMutations.length > 0 || requests.length > 0) {
        return {
          action: 'click',
          selector: candidate.selector,
          label: candidate.label,
          effect: `Clicked "${candidate.label}" — unlocked interaction`,
          succeeded: true,
          observation: {
            mutations: collectedMutations,
            networkRequests: requests,
            settleTime: 1500,
            urlChanged: false,
          },
        };
      }
    } catch {
      // Trial failed — try next candidate
    } finally {
      await trialPage.close();
    }
  }

  return undefined;
}

// ── Output zone discovery ────────────────────────────────────

async function discoverOutputZones(
  page: Page,
  containerSelector?: string,
): Promise<OutputZone[]> {
  return page.evaluate((container: string | undefined) => {
    const zones: Array<{
      selector: string;
      type: 'append' | 'replace' | 'count-change' | 'text-change' | 'visibility-toggle';
      itemSelector?: string;
      source: 'dom-proximity' | 'aria-relationship' | 'observation' | 'heuristic';
    }> = [];

    /** Build a stable CSS path for an element */
    function cssSelectorPath(el: Element): string {
      const parts: string[] = [];
      let current: Element | null = el;
      while (current && current !== document.documentElement) {
        const testId = current.getAttribute('data-testid');
        if (testId) {
          parts.unshift(`[data-testid="${testId}"]`);
          break;
        }
        const id = current.id;
        if (id) {
          parts.unshift(`#${id}`);
          break;
        }
        const role = current.getAttribute('role');
        if (role) {
          parts.unshift(`[role="${role}"]`);
        } else {
          const parent = current.parentElement;
          if (parent) {
            const tag = current.tagName.toLowerCase();
            const siblings = Array.from(parent.children).filter(
              (c) => c.tagName.toLowerCase() === tag,
            );
            if (siblings.length > 1) {
              const index = siblings.indexOf(current) + 1;
              parts.unshift(`${tag}:nth-child(${index})`);
            } else {
              parts.unshift(tag);
            }
          } else {
            parts.unshift(current.tagName.toLowerCase());
          }
        }
        current = current.parentElement;
      }
      return parts.join(' > ');
    }

    const seen = new Set<string>();

    // Look for ARIA live/log/status/list/table regions
    const ariaSelectors = [
      '[role="log"]',
      '[role="status"]',
      '[role="list"]',
      '[role="table"]',
      '[aria-live]',
    ];

    for (const sel of ariaSelectors) {
      const elements = document.querySelectorAll(sel);
      for (const el of elements) {
        const path = cssSelectorPath(el);
        if (seen.has(path)) continue;
        seen.add(path);

        const role = el.getAttribute('role');
        let zoneType: typeof zones[number]['type'] = 'text-change';
        let itemSelector: string | undefined;

        if (role === 'log' || role === 'list') {
          zoneType = 'append';
          itemSelector = `${path} > *`;
        } else if (role === 'table') {
          zoneType = 'count-change';
          itemSelector = `${path} tbody tr`;
        } else if (role === 'status') {
          zoneType = 'text-change';
        }

        zones.push({
          selector: path,
          type: zoneType,
          itemSelector,
          source: 'aria-relationship',
        });
      }
    }

    // Find the largest non-interactive child of the container
    if (container) {
      try {
        const containerEl = document.querySelector(container);
        if (containerEl) {
          const interactiveSelectors =
            'input, button, select, textarea, [role="button"], a[href]';
          const children = containerEl.querySelectorAll('*');
          let largest: Element | null = null;
          let largestArea = 0;

          for (const child of children) {
            // Skip interactive elements
            if (child.matches(interactiveSelectors)) continue;
            // Skip tiny elements
            const rect = child.getBoundingClientRect();
            const area = rect.width * rect.height;
            if (area > largestArea && rect.width > 50 && rect.height > 30) {
              largestArea = area;
              largest = child;
            }
          }

          if (largest) {
            const path = cssSelectorPath(largest);
            if (!seen.has(path)) {
              seen.add(path);
              zones.push({
                selector: path,
                type: 'text-change',
                source: 'dom-proximity',
              });
            }
          }
        }
      } catch {
        // Container selector might be invalid
      }
    }

    return zones;
  }, containerSelector);
}

// ── CSS path builder for MutationObserver (runs in browser) ──

const MUTATION_OBSERVER_SCRIPT = `
  window.__uicMutations = [];

  function __uicCssPath(el) {
    const parts = [];
    let current = el;
    while (current && current !== document.documentElement) {
      const testId = current.getAttribute ? current.getAttribute('data-testid') : null;
      if (testId) {
        parts.unshift('[data-testid="' + testId + '"]');
        break;
      }
      const id = current.id;
      if (id) {
        parts.unshift('#' + id);
        break;
      }
      const role = current.getAttribute ? current.getAttribute('role') : null;
      if (role) {
        parts.unshift('[role="' + role + '"]');
      } else {
        const parent = current.parentElement;
        if (parent) {
          const tag = current.tagName.toLowerCase();
          const siblings = Array.from(parent.children).filter(
            function(c) { return c.tagName.toLowerCase() === tag; }
          );
          if (siblings.length > 1) {
            const index = siblings.indexOf(current) + 1;
            parts.unshift(tag + ':nth-child(' + index + ')');
          } else {
            parts.unshift(tag);
          }
        } else {
          parts.unshift(current.tagName ? current.tagName.toLowerCase() : 'unknown');
        }
      }
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  const __uicObs = new MutationObserver(function(muts) {
    for (const m of muts) {
      window.__uicMutations.push({
        type: m.type,
        targetSelector: __uicCssPath(m.target),
        addedCount: m.addedNodes.length,
        removedCount: m.removedNodes.length,
        attributeName: m.attributeName || undefined,
      });
    }
  });
  __uicObs.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
  });
`;

// ── Main observation function ────────────────────────────────

export async function observeInteraction(
  context: BrowserContext,
  group: InteractionGroup,
  config: UicConfig,
  projectRoot: string,
): Promise<InteractionObservation> {
  const page = await context.newPage();
  const startTime = Date.now();

  try {
    // 1. Navigate to route
    await page.goto(config.app.baseUrl + group.route);
    const waitUntil = config.discovery.waitUntil === 'commit' ? 'domcontentloaded' : (config.discovery.waitUntil || 'domcontentloaded');
    await page.waitForLoadState(waitUntil as 'load' | 'domcontentloaded' | 'networkidle');

    // 2. Find output zones
    const discoveredZones = await discoverOutputZones(page, group.containerSelector);
    const outputZones: OutputZone[] = [
      ...group.members.outputs,
      ...discoveredZones.filter(
        (dz) => !group.members.outputs.some((o) => o.selector === dz.selector),
      ),
    ];

    // 3. Record "before" state from the first output zone (if any)
    let beforeText = '';
    let beforeCount = 0;
    const primaryZone = outputZones[0];
    if (primaryZone) {
      try {
        beforeText = (await page.locator(primaryZone.selector).textContent()) || '';
      } catch {
        beforeText = '';
      }
      try {
        beforeCount = await page
          .locator(primaryZone.itemSelector || `${primaryZone.selector} > *`)
          .count();
      } catch {
        beforeCount = 0;
      }
    }

    // 4. Take "before" screenshot if configured
    const takeScreenshots = config.observe?.screenshots !== false;
    let screenshotBefore: string | undefined;
    if (takeScreenshots) {
      const ssPath = `${projectRoot}/.uic/screenshots/${group.id.replace(/[/:\\]/g, '_')}_before.png`;
      try {
        await page.screenshot({ path: ssPath, fullPage: false });
        screenshotBefore = ssPath;
      } catch {
        // Screenshot failure is non-fatal
      }
    }

    // 5. Install MutationObserver
    await page.evaluate(MUTATION_OBSERVER_SCRIPT);

    // 6. Set up network interception
    const requests: ObservedRequest[] = [];
    page.on('response', (resp) => {
      requests.push({
        url: resp.url(),
        method: resp.request().method(),
        status: resp.status(),
        contentType: resp.headers()['content-type'],
      });
    });

    // 7. Record URL before interaction
    const urlBefore = page.url();

    // 8. Perform the interaction
    // Fill inputs with test data
    for (const inputSelector of group.members.inputs) {
      try {
        const locator = page.locator(inputSelector);
        const isVisible = await locator.isVisible().catch(() => false);
        if (!isVisible) continue;
        await locator.fill(testValueForSelector(inputSelector));
      } catch {
        // Input might not be fillable — skip gracefully
      }
    }

    // Click triggers
    if (group.members.triggers.length > 0) {
      for (const triggerSelector of group.members.triggers) {
        try {
          const locator = page.locator(triggerSelector);
          const isVisible = await locator.isVisible().catch(() => false);
          if (!isVisible) continue;
          await locator.click();
        } catch {
          // Trigger might not be clickable — skip gracefully
        }
      }
    } else if (group.members.inputs.length > 0) {
      // No trigger — try pressing Enter on the last input
      const lastInput = group.members.inputs[group.members.inputs.length - 1];
      try {
        await page.locator(lastInput).press('Enter');
      } catch {
        // Enter press failed — non-fatal
      }
    }

    // 9. Wait for settle — poll until no new mutations for 500ms, max 10s
    let lastCount = 0;
    const settleStart = Date.now();
    const maxSettle = ['chat', 'search'].includes(group.pattern) ? 30000 : 10000;
    while (Date.now() - settleStart < maxSettle) {
      await page.waitForTimeout(500);
      const currentCount = await page.evaluate(() => window.__uicMutations?.length || 0);
      if (currentCount === lastCount) break;
      lastCount = currentCount;
    }
    const settleTime = Date.now() - settleStart;

    // 10. Collect mutations (filtered)
    const mutations: ObservedMutation[] = await page.evaluate(() => {
      const result = window.__uicMutations || [];
      return result.filter((m) => {
        // Filter out volatile mutations (class changes, style, timestamps)
        if (
          m.type === 'attributes' &&
          (m.attributeName === 'class' || m.attributeName === 'style')
        ) {
          return false;
        }
        return true;
      });
    });

    // 11. Record "after" state
    let afterText = '';
    let afterCount = 0;
    if (primaryZone) {
      try {
        afterText = (await page.locator(primaryZone.selector).textContent()) || '';
      } catch {
        afterText = '';
      }
      try {
        afterCount = await page
          .locator(primaryZone.itemSelector || `${primaryZone.selector} > *`)
          .count();
      } catch {
        afterCount = 0;
      }
    }

    // 12. Take "after" screenshot if configured
    let screenshotAfter: string | undefined;
    if (takeScreenshots) {
      const ssPath = `${projectRoot}/.uic/screenshots/${group.id.replace(/[/:\\]/g, '_')}_after.png`;
      try {
        await page.screenshot({ path: ssPath, fullPage: false });
        screenshotAfter = ssPath;
      } catch {
        // Screenshot failure is non-fatal
      }
    }

    // 13. Check if URL changed
    const urlAfter = page.url();
    const urlChanged = urlAfter !== urlBefore;

    // 14. Build observation result
    const observation: InteractionObservation = {
      mutations,
      networkRequests: requests,
      settleTime,
      urlChanged,
      newUrl: urlChanged ? urlAfter : undefined,
      outputDelta: primaryZone
        ? {
            before: beforeText,
            after: afterText,
            itemCountBefore: beforeCount,
            itemCountAfter: afterCount,
          }
        : undefined,
      screenshotBefore,
      screenshotAfter,
    };

    // Quality score
    observation.qualityScore = scoreInteractionQuality(observation, true);

    // Prerequisite exploration if no-effect
    const isNoEffect = observation.mutations.length === 0
      && observation.networkRequests.length === 0
      && !observation.urlChanged;

    if (isNoEffect && config.observe?.prerequisiteExploration !== false) {
      const prereq = await explorePrerequisites(context, group, config);
      if (prereq?.succeeded && prereq.observation) {
        observation.prerequisite = prereq;
        observation.mutations = prereq.observation.mutations;
        observation.networkRequests = prereq.observation.networkRequests;
        observation.settleTime = prereq.observation.settleTime;
        observation.urlChanged = prereq.observation.urlChanged;
        observation.outputDelta = prereq.observation.outputDelta;
        // Recompute quality with the enriched data
        observation.qualityScore = scoreInteractionQuality(observation, true);
      }
    }

    return observation;
  } finally {
    await page.close();
  }
}

// ── Batch observation helper ─────────────────────────────────

export async function observeAllGroups(
  context: BrowserContext,
  groups: InteractionGroup[],
  config: UicConfig,
  projectRoot: string,
): Promise<Map<string, InteractionObservation>> {
  const results = new Map<string, InteractionObservation>();
  const budget = config.observe?.budget || 50;
  const blockMutating = config.observe?.blockMutating !== false;

  let observed = 0;

  for (const group of groups) {
    if (observed >= budget) break;

    // Skip groups where all members are mutating (state-changing)
    if (blockMutating) {
      const allInputs = group.members.inputs.length;
      const allTriggers = group.members.triggers.length;
      // A group is considered "all mutating" if it has no read-only elements
      // (i.e., it consists only of inputs and triggers with no output zones)
      if (allInputs + allTriggers > 0 && group.members.outputs.length === 0) {
        // Heuristic: if pattern looks destructive, skip
        if (
          group.pattern === 'crud-create' ||
          group.pattern === 'form-submit' ||
          group.pattern === 'auth-flow'
        ) {
          continue;
        }
      }
    }

    try {
      const observation = await observeInteraction(context, group, config, projectRoot);
      results.set(group.id, observation);
      observed++;
    } catch (err) {
      // Log but continue — observation failures should not halt the pipeline
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[observer] Failed to observe group ${group.id}: ${message}`);
    }
  }

  return results;
}
