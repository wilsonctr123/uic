/**
 * Contract Differ
 *
 * Compares two contracts or a contract against an inventory
 * to detect drift: added, removed, and changed surfaces/flows.
 */

import type { UIContract, UIInventory, Surface, Flow } from '../config/types.js';

export interface ContractDiff {
  addedSurfaces: string[];
  removedSurfaces: string[];
  changedSurfaces: Array<{
    id: string;
    addedElements: number;
    removedElements: number;
  }>;
  addedFlows: string[];
  removedFlows: string[];
  summary: string;
}

export function diffContracts(existing: UIContract, updated: UIContract): ContractDiff {
  const existingIds = new Set(existing.surfaces.map(s => s.id));
  const updatedIds = new Set(updated.surfaces.map(s => s.id));

  const addedSurfaces = [...updatedIds].filter(id => !existingIds.has(id));
  const removedSurfaces = [...existingIds].filter(id => !updatedIds.has(id));

  const changedSurfaces: ContractDiff['changedSurfaces'] = [];
  for (const id of existingIds) {
    if (!updatedIds.has(id)) continue;
    const es = existing.surfaces.find(s => s.id === id)!;
    const us = updated.surfaces.find(s => s.id === id)!;

    const existingElNames = new Set(es.expectations.required_elements.map(e => e.name || e.selector));
    const updatedElNames = new Set(us.expectations.required_elements.map(e => e.name || e.selector));

    const addedElements = [...updatedElNames].filter(n => !existingElNames.has(n)).length;
    const removedElements = [...existingElNames].filter(n => !updatedElNames.has(n)).length;

    if (addedElements > 0 || removedElements > 0) {
      changedSurfaces.push({ id, addedElements, removedElements });
    }
  }

  const existingFlowIds = new Set(existing.flows.map(f => f.id));
  const updatedFlowIds = new Set(updated.flows.map(f => f.id));
  const addedFlows = [...updatedFlowIds].filter(id => !existingFlowIds.has(id));
  const removedFlows = [...existingFlowIds].filter(id => !updatedFlowIds.has(id));

  const parts: string[] = [];
  if (addedSurfaces.length) parts.push(`+${addedSurfaces.length} surfaces`);
  if (removedSurfaces.length) parts.push(`-${removedSurfaces.length} surfaces`);
  if (changedSurfaces.length) parts.push(`~${changedSurfaces.length} changed`);
  if (addedFlows.length) parts.push(`+${addedFlows.length} flows`);
  if (removedFlows.length) parts.push(`-${removedFlows.length} flows`);

  return {
    addedSurfaces,
    removedSurfaces,
    changedSurfaces,
    addedFlows,
    removedFlows,
    summary: parts.length ? parts.join(', ') : 'No changes',
  };
}

/**
 * Apply a diff to update an existing contract preserving manual edits.
 * - Added surfaces/flows are appended
 * - Removed items are marked status: 'removed' (not deleted)
 * - Changed surfaces get updated element lists
 */
export function applyDiff(existing: UIContract, updated: UIContract, diff: ContractDiff): UIContract {
  const result = JSON.parse(JSON.stringify(existing)) as UIContract;
  result.generatedAt = new Date().toISOString();

  // Mark removed surfaces
  for (const id of diff.removedSurfaces) {
    const surface = result.surfaces.find(s => s.id === id);
    if (surface) {
      surface.metadata.status = 'removed';
    }
  }

  // Add new surfaces
  for (const id of diff.addedSurfaces) {
    const surface = updated.surfaces.find(s => s.id === id);
    if (surface) result.surfaces.push(surface);
  }

  // Update changed surfaces (merge elements, preserve policy)
  for (const change of diff.changedSurfaces) {
    const existing_s = result.surfaces.find(s => s.id === change.id);
    const updated_s = updated.surfaces.find(s => s.id === change.id);
    if (existing_s && updated_s) {
      // Preserve existing required/policy but update elements
      const existingElNames = new Set(existing_s.expectations.required_elements.map(e => e.name || e.selector));
      for (const el of updated_s.expectations.required_elements) {
        const key = el.name || el.selector;
        if (!existingElNames.has(key)) {
          existing_s.expectations.required_elements.push(el);
        }
      }
      existing_s.metadata.last_seen = new Date().toISOString().split('T')[0];
    }
  }

  // Mark removed flows
  for (const id of diff.removedFlows) {
    const flow = result.flows.find(f => f.id === id);
    if (flow) flow.status = 'removed';
  }

  // Add new flows
  for (const id of diff.addedFlows) {
    const flow = updated.flows.find(f => f.id === id);
    if (flow) result.flows.push(flow);
  }

  return result;
}
