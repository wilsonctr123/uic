/**
 * Contract Generator
 *
 * Transforms a UIInventory into a UIContract by:
 * 1. Creating surfaces from discovered routes + elements
 * 2. Generating default flows from page structure
 * 3. Adding standard invariants
 * 4. Carrying over exclusions from config
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  UIInventory, UIContract, Surface, Flow, Invariant,
  DiscoveredRoute, DiscoveredElement, RequiredElement,
  UicConfig, Exclusion,
} from '../config/types.js';

function routeNameFromPath(p: string): string {
  if (p === '/') return 'Home';
  return p.split('/').filter(Boolean).map(s => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ')).join(' ');
}

function buildSurfaceId(route: string, persona: string, viewport: string, state: string): string {
  const routePart = route === '/' ? 'home' : route.replace(/^\//, '').replace(/\//g, '-');
  return `${routePart}|${persona}|${viewport}|${state}`;
}

function significantElements(elements: DiscoveredElement[]): DiscoveredElement[] {
  return elements.filter(el =>
    el.visible &&
    el.classification !== 'other' &&
    el.classification !== 'link' // links are low-signal unless nav
  );
}

function toRequiredElements(elements: DiscoveredElement[]): RequiredElement[] {
  const significant = significantElements(elements);
  const seen = new Set<string>();
  const result: RequiredElement[] = [];

  for (const el of significant) {
    const key = `${el.classification}:${el.label || el.text?.substring(0, 30) || el.selector}`;
    if (seen.has(key)) continue;
    seen.add(key);

    result.push({
      role: el.role || undefined,
      name: el.label || el.text?.substring(0, 50) || undefined,
      selector: el.selector,
      required: ['button', 'text-input', 'password-input', 'email-input', 'form', 'table'].includes(el.classification),
      note: undefined,
    });
  }

  return result;
}

function generateFlows(route: DiscoveredRoute): Flow[] {
  const flows: Flow[] = [];
  const name = routeNameFromPath(route.path);

  // Every route gets a "loads successfully" flow
  flows.push({
    id: `${route.path === '/' ? 'home' : route.path.replace(/^\//, '')}-loads`,
    name: `${name} page loads successfully`,
    steps: ['navigate to page', 'verify key content visible', 'no console errors'],
    required: true,
    persona: route.requiresAuth ? 'user' : 'guest',
  });

  // Routes with forms get a submission flow
  const hasForm = route.elements.some(e =>
    e.classification === 'form' ||
    e.classification === 'text-input' ||
    e.classification === 'email-input' ||
    e.classification === 'password-input'
  );
  if (hasForm) {
    flows.push({
      id: `${route.path === '/' ? 'home' : route.path.replace(/^\//, '')}-form`,
      name: `${name} form submission`,
      steps: ['fill form fields', 'submit form', 'verify success feedback'],
      required: true,
      persona: route.requiresAuth ? 'user' : 'guest',
    });
  }

  // Routes with tables get a data display flow
  const hasTable = route.elements.some(e => e.classification === 'table');
  if (hasTable) {
    flows.push({
      id: `${route.path === '/' ? 'home' : route.path.replace(/^\//, '')}-table`,
      name: `${name} table displays data`,
      steps: ['load page with data', 'verify table renders rows', 'verify pagination if present'],
      required: false,
      persona: route.requiresAuth ? 'user' : 'guest',
    });
  }

  return flows;
}

export function generateContract(
  inventory: UIInventory,
  config: UicConfig,
): UIContract {
  const surfaces: Surface[] = [];
  const flows: Flow[] = [];

  for (const route of inventory.routes) {
    // Create surface for initial desktop state
    const surface: Surface = {
      id: buildSurfaceId(route.path, route.requiresAuth ? 'user' : 'guest', 'desktop', 'initial'),
      route: route.path,
      persona: route.requiresAuth ? 'user' : 'guest',
      viewport: 'desktop',
      state: 'initial',
      checkpoint: 'page-load',
      expectations: {
        required_elements: toRequiredElements(route.elements),
        forbidden_elements: [],
        no_console_errors: true,
        no_failed_requests: true,
        navigation_works: true,
        visual_snapshot: false,
      },
      policy: {
        required: true,
        severity: 'blocking',
        rationale: `Core route: ${routeNameFromPath(route.path)}`,
      },
      metadata: {
        discovered_at: route.discoveredAt.split('T')[0],
        last_seen: route.discoveredAt.split('T')[0],
        source: 'auto-discovery',
        status: route.confidence === 'low' ? 'unreachable' : 'active',
      },
    };
    surfaces.push(surface);

    // Generate flows for this route
    flows.push(...generateFlows(route));
  }

  const invariants: Invariant[] = [
    { name: 'no-console-errors', required: true, description: 'No JavaScript console errors on any page' },
    { name: 'no-failed-requests', required: true, description: 'No failed frontend API requests (excluding auth checks)' },
    { name: 'critical-ui-visible', required: true, description: 'Navigation and primary content visible on all pages' },
    { name: 'auth-redirect', required: true, description: 'Unauthenticated users redirected to login for protected routes' },
  ];

  return {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    app: {
      name: config.app.name,
      baseUrl: config.app.baseUrl,
      framework: config.app.framework,
    },
    surfaces,
    flows,
    invariants,
    exclusions: config.exclusions || [],
  };
}

export function writeContract(contract: UIContract, outputPath: string): void {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(contract, null, 2));
  console.log(`\n📋 Contract written → ${outputPath}`);
  console.log(`   Surfaces: ${contract.surfaces.length}`);
  console.log(`   Flows: ${contract.flows.length}`);
  console.log(`   Invariants: ${contract.invariants.length}`);
  console.log(`   Exclusions: ${contract.exclusions.length}\n`);
}
