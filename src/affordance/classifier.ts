/**
 * Affordance Classifier
 *
 * Transforms raw discovered elements into deduplicated affordances.
 * Each affordance has: element type, primary action, oracle (expected outcome),
 * and disposition (executable/grouped/blocked/informational/excluded).
 *
 * Deduplication: elements with the same (route, role, name) collapse into one.
 * Filtering: invisible, disabled, decorative, and "other" elements are excluded.
 */

import type {
  DiscoveredElement, DiscoveredRoute, UicConfig, Exclusion,
  Affordance, AffordanceElementType, ActionType, OracleType, AffordanceDisposition,
  FixtureRequirement,
} from '../config/types.js';

// ── Element → AffordanceElementType mapping ──

function toElementType(el: DiscoveredElement): AffordanceElementType | null {
  switch (el.classification) {
    case 'button': return 'button';
    case 'link': return 'link';
    case 'text-input': case 'password-input': case 'email-input':
    case 'search-input': case 'date-input': return 'input';
    case 'file-upload': return 'file-input';
    case 'checkbox': case 'toggle': return 'checkbox';
    case 'select': return 'select';
    case 'textarea': return 'textarea';
    case 'table': return 'table';
    case 'dialog': return 'dialog';
    case 'form': return 'form';
    case 'tab': return 'button'; // tabs act like buttons
    case 'menu': return 'button';
    default: return null; // 'other' → filtered out
  }
}

// ── Action inference ──

function inferAction(el: DiscoveredElement, elType: AffordanceElementType): ActionType {
  if (elType === 'link') return 'navigate';
  if (elType === 'file-input') return 'upload';
  if (elType === 'checkbox') return 'toggle';
  if (elType === 'select') return 'select-option';
  if (elType === 'input' || elType === 'textarea') return 'fill';
  return 'click'; // buttons, tabs, menus, dialogs
}

// ── Oracle inference ──

function inferOracle(el: DiscoveredElement, elType: AffordanceElementType, action: ActionType): OracleType {
  // Links with href → navigation
  if (elType === 'link' && el.href) return 'url-changes';

  // File upload → content appears
  if (elType === 'file-input') return 'content-changes';

  // Checkbox/toggle → attribute changes
  if (elType === 'checkbox') return 'attribute-changes';

  // Select → content changes
  if (elType === 'select') return 'content-changes';

  // Button oracle inferred from label text
  if (elType === 'button') {
    const text = (el.label || el.text || '').toLowerCase();

    // Submit/save/create → network fires
    if (/save|submit|create|import|change password|sign in|log in|send|reset/.test(text)) return 'network-fires';

    // Delete/remove → element disappears
    if (/delete|remove|clear/.test(text)) return 'element-disappears';

    // Add/new/create → element appears
    if (/add|new|create/.test(text)) return 'element-appears';

    // Next/previous/pagination → content changes
    if (/next|previous|page/.test(text)) return 'content-changes';

    // Filter/mode chips (short labels, siblings) → attribute changes
    if (text.length <= 15 && !/downloads/.test(text)) return 'attribute-changes';

    // Downloads/open dialog
    if (/downloads/.test(text)) return 'element-appears';
  }

  // Input fields → conservative
  if (action === 'fill') return 'no-crash';

  // Fallback
  return 'no-crash';
}

// ── Severity inference ──

function inferSeverity(el: DiscoveredElement, elType: AffordanceElementType): 'blocking' | 'warning' | 'info' {
  // Navigation links → info (low value individually)
  if (elType === 'link') return 'info';

  // Tables, dialogs, forms → informational containers
  if (elType === 'table' || elType === 'dialog' || elType === 'form') return 'info';

  // Interactive controls → blocking
  return 'blocking';
}

// ── Fixture detection ──

function detectFixture(route: string, el: DiscoveredElement, elType: AffordanceElementType): FixtureRequirement | undefined {
  const text = (el.label || el.text || '').toLowerCase();

  // Admin routes need admin role
  if (route === '/admin') {
    return { type: 'admin-role', description: 'Requires admin user', available: true };
  }

  // File upload needs a test file
  if (elType === 'file-input') {
    return { type: 'file', description: 'Requires test file for upload', available: true };
  }

  // API key fields need values
  if (/api key/.test(text)) {
    return { type: 'api-key', description: 'Requires API key value', available: false };
  }

  // Pagination needs data
  if (/next|previous/.test(text)) {
    return { type: 'data-seed', description: 'Requires data for pagination', available: false };
  }

  return undefined;
}

// ── Mutation detection ──

function isMutating(el: DiscoveredElement, oracle: OracleType): boolean {
  const text = (el.label || el.text || '').toLowerCase();
  if (/create|save|submit|delete|remove|import|add|reset|change/.test(text)) return true;
  if (oracle === 'network-fires') return true;
  return false;
}

// ── Exclusion matching ──

function matchesExclusion(route: string, el: DiscoveredElement, exclusions: Exclusion[]): Exclusion | undefined {
  for (const ex of exclusions) {
    if (route.includes(ex.pattern)) return ex;
    const text = (el.label || el.text || el.selector || '').toLowerCase();
    if (text.includes(ex.pattern.toLowerCase())) return ex;
  }
  return undefined;
}

// ── Deduplication key ──

function deduplicationKey(route: string, el: DiscoveredElement): string {
  const role = el.role || el.tag;
  const name = el.label || el.text?.substring(0, 40) || el.placeholder || el.name || el.selector;
  return `${route}|${role}|${name}`;
}

// ── Affordance ID ──

function makeAffordanceId(route: string, elType: AffordanceElementType, label: string, index: number): string {
  const routePart = route === '/' ? 'home' : route.replace(/^\//, '').replace(/\//g, '-');
  const labelPart = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '').substring(0, 30);
  return `${routePart}:${elType}:${labelPart || index}`;
}

// ── Main classifier ──

export interface ClassifyResult {
  affordances: Affordance[];
  rawCount: number;
  deduplicatedCount: number;
}

export function classifyAffordances(
  routes: DiscoveredRoute[],
  config: UicConfig,
): ClassifyResult {
  const exclusions = config.exclusions || [];
  const seen = new Set<string>();
  const affordances: Affordance[] = [];
  let rawCount = 0;

  // Detect redirect duplicates: guest routes (login, forgot-password)
  // crawled by an authenticated user redirect to home, capturing home's elements.
  // Build a set of element signatures from authenticated routes to detect this.
  const guestRoutes = new Set(['/login', '/forgot-password', '/reset-password', '/signup']);
  const authRouteElementKeys = new Set<string>();
  for (const route of routes) {
    if (guestRoutes.has(route.path)) continue;
    for (const el of route.elements) {
      const role = el.role || el.tag;
      const name = el.label || el.text?.substring(0, 40) || el.placeholder || el.name || '';
      authRouteElementKeys.add(`${role}|${name}`);
    }
  }

  for (const route of routes) {
    let routeIndex = 0;
    const isGuestRoute = guestRoutes.has(route.path);

    for (const el of route.elements) {
      rawCount++;

      // Filter: invisible
      if (!el.visible) continue;
      // Filter: disabled elements → blocked
      if (el.disabled) {
        // Still count for accounting but mark as blocked
        const elType = toElementType(el);
        if (!elType) continue;
        const label = el.label || el.text?.substring(0, 50) || el.placeholder || el.name || el.selector;
        const key = deduplicationKey(route.path, el);
        if (seen.has(key)) continue;
        seen.add(key);
        rawCount--; // don't double-count, will be re-incremented
        affordances.push({
          id: makeAffordanceId(route.path, elType, label, routeIndex++),
          route: route.path,
          elementType: elType,
          action: inferAction(el, elType),
          oracle: 'no-crash' as OracleType,
          severity: 'info',
          disposition: 'blocked',
          target: { role: el.role, name: el.label || el.text?.substring(0, 50), selector: el.selector, placeholder: el.placeholder },
          label,
          confidence: 'high',
          mutatesState: false,
          blockReason: 'Element is disabled',
          generatedTest: false,
          persona: route.requiresAuth ? 'user' : 'guest',
        });
        continue;
      }

      // Filter: classify element type
      const elType = toElementType(el);
      if (!elType) continue; // 'other' elements dropped

      // Filter: skip redirect-duplicate elements on guest routes
      // If a guest route element also appears on an auth route, it was captured
      // because the authenticated crawler got redirected (e.g., /login → /)
      if (isGuestRoute && route.confidence === 'low') {
        continue; // low confidence = redirect, skip all elements
      }
      if (isGuestRoute) {
        const elKey = `${el.role || el.tag}|${el.label || el.text?.substring(0, 40) || el.placeholder || el.name || ''}`;
        if (authRouteElementKeys.has(elKey)) continue; // duplicate from redirect
      }

      // Deduplicate by (route, role, name)
      const key = deduplicationKey(route.path, el);
      if (seen.has(key)) continue;
      seen.add(key);

      const action = inferAction(el, elType);
      const oracle = inferOracle(el, elType, action);
      let severity = inferSeverity(el, elType);
      const label = el.label || el.text?.substring(0, 50) || el.placeholder || el.name || el.selector;
      const id = makeAffordanceId(route.path, elType, label, routeIndex++);
      const fixture = detectFixture(route.path, el, elType);
      const mutates = isMutating(el, oracle);

      // Dynamic/unnamed elements → informational (can't generate reliable locator)
      const labelLower = label.toLowerCase();
      const isUnnamed = !el.label && !el.text && !el.placeholder && !el.name;
      const isDynamicUserButton = elType === 'button' && (
        /^[A-Z]\s/.test(label) || // avatar initial + name pattern "U UIC Test"
        el.selector.includes('avatar') ||
        (el.text && el.text.length > 15 && !el.role) // long text, no semantic role
      );

      // Rule 3: Downgrade resistance — try 4 locator strategies before downgrading
      const repairHints: string[] = [];
      if (isUnnamed || isDynamicUserButton) {
        const hasAriaLabel = !!el.label;
        const hasPlaceholder = !!el.placeholder;
        const hasRole = !!el.role;
        const hasUniqueSelector = !!el.selector && !/^[a-z]+(\.[a-z])?$/i.test(el.selector);

        if (hasAriaLabel) {
          repairHints.push(`Use aria-label: ${el.label}`);
        } else if (hasPlaceholder) {
          repairHints.push(`Use placeholder: ${el.placeholder}`);
        } else if (hasRole && hasUniqueSelector) {
          repairHints.push(`Use contextual locator: role=${el.role} within ${el.selector}`);
        } else if (hasUniqueSelector) {
          repairHints.push(`Use specific selector: ${el.selector}`);
        } else {
          // All 4 strategies exhausted — legitimate downgrade
          severity = 'info';
          repairHints.push('All locator strategies exhausted, downgraded to informational');
        }
      }

      // Determine disposition
      let disposition: AffordanceDisposition = 'executable';
      let blockReason: string | undefined;
      let excludedBy: string | undefined;
      let groupedInto: string | undefined;

      // Check exclusions
      const exclusion = matchesExclusion(route.path, el, exclusions);
      if (exclusion) {
        disposition = 'excluded';
        excludedBy = exclusion.pattern;
      }
      // Tables and forms are containers — group their children
      else if (elType === 'table' || elType === 'form') {
        disposition = 'informational';
      }
      // Blocked if fixture unavailable
      else if (fixture && !fixture.available) {
        disposition = 'blocked';
        blockReason = `Missing fixture: ${fixture.description}`;
      }

      affordances.push({
        id,
        route: route.path,
        elementType: elType,
        action,
        oracle,
        severity,
        disposition,
        target: {
          role: el.role || undefined,
          name: el.label || el.text?.substring(0, 50) || undefined,
          selector: el.selector,
          placeholder: el.placeholder || undefined,
        },
        label,
        confidence: route.confidence === 'low' ? 'low' : (el.role && el.label ? 'high' : 'medium'),
        fixture,
        mutatesState: mutates,
        blockReason,
        groupedInto,
        excludedBy,
        generatedTest: false,
        persona: route.requiresAuth ? 'user' : 'guest',
        repairHints: repairHints.length > 0 ? repairHints : undefined,
      });
    }
  }

  return {
    affordances,
    rawCount,
    deduplicatedCount: affordances.length,
  };
}
