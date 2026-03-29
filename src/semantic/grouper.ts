/**
 * Element Grouper — groups discovered elements into InteractionGroups
 * using container hierarchy, spatial proximity, and ARIA relationships.
 *
 * Runs in the browser context during discovery (needs live Playwright page).
 */

import type { Page } from 'playwright';
import type { DiscoveredElement, ElementGrouping } from '../config/types.js';

/** Semantic container selectors used during DOM walk-up */
const SEMANTIC_CONTAINERS = [
  'form',
  'section',
  '[role="search"]',
  '[role="dialog"]',
  '[role="region"]',
];

/** ARIA relationship attributes we track */
const ARIA_RELATIONSHIPS = [
  'aria-controls',
  'aria-describedby',
  'aria-owns',
  'form',
] as const;

interface BrowserGroupResult {
  /** CSS path of the container element */
  containerCssPath: string;
  /** Bounding rect of the container */
  boundingBox: { x: number; y: number; width: number; height: number };
  /** Selector of the member element */
  memberSelector: string;
  /** ARIA relationships from this element */
  ariaRelationships: Array<{ from: string; to: string; type: string }>;
}

/**
 * Groups discovered elements by their nearest semantic container.
 *
 * For each element, walks up the DOM to find the nearest semantic container
 * (`<form>`, `<section>`, `[role]`, or ancestor containing both input + button).
 * Elements sharing the same container form a group.
 */
export async function groupElements(
  page: Page,
  elements: DiscoveredElement[],
  routePath: string,
): Promise<ElementGrouping[]> {
  if (elements.length === 0) return [];

  const selectors = elements.map((el) => el.selector);

  // Run DOM analysis in browser context
  const results = await page.evaluate(
    (args: {
      selectors: string[];
      semanticContainers: string[];
      ariaAttrs: string[];
    }) => {
      const { selectors: sels, semanticContainers: containers, ariaAttrs } = args;

      /** Generate a stable CSS path for an element */
      function cssSelectorPath(el: Element): string {
        const parts: string[] = [];
        let current: Element | null = el;
        while (current && current !== document.documentElement) {
          // Prefer data-testid
          const testId = current.getAttribute('data-testid');
          if (testId) {
            parts.unshift(`[data-testid="${testId}"]`);
            break;
          }
          // Prefer id
          const id = current.id;
          if (id) {
            parts.unshift(`#${id}`);
            break;
          }
          // Prefer role
          const role = current.getAttribute('role');
          if (role) {
            parts.unshift(`[role="${role}"]`);
            // role may not be unique, keep walking
          } else {
            // tag + nth-child
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

      /** Check if an element matches any semantic container selector */
      function isSemanticContainer(el: Element): boolean {
        return containers.some((sel) => {
          try {
            return el.matches(sel);
          } catch {
            return false;
          }
        });
      }

      /** Check if an element contains both an input-like element and a button */
      function containsInputAndButton(el: Element): boolean {
        const hasInput = el.querySelector(
          'input, textarea, select, [contenteditable="true"]',
        ) !== null;
        const hasButton = el.querySelector(
          'button, [role="button"], input[type="submit"]',
        ) !== null;
        return hasInput && hasButton;
      }

      /** Walk up the DOM from el to find the nearest semantic container */
      function findContainer(el: Element): Element | null {
        let current: Element | null = el.parentElement;
        // Walk up at most 15 levels
        let depth = 0;
        while (current && current !== document.body && depth < 15) {
          if (isSemanticContainer(current)) {
            return current;
          }
          if (containsInputAndButton(current)) {
            return current;
          }
          current = current.parentElement;
          depth++;
        }
        return null;
      }

      /** Collect ARIA relationships from an element */
      function collectAriaRelationships(
        el: Element,
        elSelector: string,
      ): Array<{ from: string; to: string; type: string }> {
        const rels: Array<{ from: string; to: string; type: string }> = [];
        for (const attr of ariaAttrs) {
          const value = el.getAttribute(attr);
          if (!value) continue;
          // ARIA attrs may reference IDs (space-separated)
          const targetIds = value.split(/\s+/);
          for (const targetId of targetIds) {
            const targetEl = document.getElementById(targetId);
            if (targetEl) {
              rels.push({
                from: elSelector,
                to: cssSelectorPath(targetEl),
                type: attr,
              });
            }
          }
        }
        return rels;
      }

      const groupResults: Array<{
        containerCssPath: string;
        boundingBox: { x: number; y: number; width: number; height: number };
        memberSelector: string;
        ariaRelationships: Array<{ from: string; to: string; type: string }>;
      }> = [];

      for (const sel of sels) {
        let el: Element | null = null;
        try {
          el = document.querySelector(sel);
        } catch {
          continue;
        }
        if (!el) continue;

        const container = findContainer(el);
        if (!container) continue;

        const rect = container.getBoundingClientRect();
        const containerPath = cssSelectorPath(container);
        const ariaRels = collectAriaRelationships(el, sel);

        groupResults.push({
          containerCssPath: containerPath,
          boundingBox: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
          memberSelector: sel,
          ariaRelationships: ariaRels,
        });
      }

      return groupResults;
    },
    {
      selectors,
      semanticContainers: SEMANTIC_CONTAINERS,
      ariaAttrs: [...ARIA_RELATIONSHIPS],
    },
  ) as BrowserGroupResult[];

  // Group by container CSS path
  const containerMap = new Map<
    string,
    {
      boundingBox: { x: number; y: number; width: number; height: number };
      members: string[];
      ariaRelationships: Array<{ from: string; to: string; type: string }>;
    }
  >();

  for (const result of results) {
    const existing = containerMap.get(result.containerCssPath);
    if (existing) {
      existing.members.push(result.memberSelector);
      existing.ariaRelationships.push(...result.ariaRelationships);
    } else {
      containerMap.set(result.containerCssPath, {
        boundingBox: result.boundingBox,
        members: [result.memberSelector],
        ariaRelationships: [...result.ariaRelationships],
      });
    }
  }

  // Build ElementGrouping[], filtering groups with < 2 members
  const groupings: ElementGrouping[] = [];
  let index = 0;

  for (const [containerSelector, data] of containerMap) {
    if (data.members.length < 2) continue;

    // Deduplicate ARIA relationships
    const seenRels = new Set<string>();
    const uniqueRels: Array<{ from: string; to: string; type: string }> = [];
    for (const rel of data.ariaRelationships) {
      const key = `${rel.from}|${rel.to}|${rel.type}`;
      if (!seenRels.has(key)) {
        seenRels.add(key);
        uniqueRels.push(rel);
      }
    }

    groupings.push({
      id: `${routePath}:group:${index}`,
      containerSelector,
      memberSelectors: data.members,
      boundingBox: data.boundingBox,
      ariaRelationships: uniqueRels,
    });
    index++;
  }

  return groupings;
}
