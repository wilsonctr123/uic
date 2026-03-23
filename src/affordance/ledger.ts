/**
 * Affordance Ledger
 *
 * Builds the accounting artifact that proves every discovered element
 * was explicitly accounted for. The invariant:
 *   deduplicatedTo === accountedFor
 *   unaccounted === 0
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Affordance, AffordanceLedger } from '../config/types.js';
import type { ClassifyResult } from './classifier.js';

export function buildLedger(result: ClassifyResult): AffordanceLedger {
  const { affordances, rawCount, deduplicatedCount } = result;

  const dispositions = {
    executable: 0,
    grouped: 0,
    blocked: 0,
    informational: 0,
    excluded: 0,
  };

  for (const a of affordances) {
    dispositions[a.disposition]++;
  }

  const accountedFor = dispositions.executable + dispositions.grouped
    + dispositions.blocked + dispositions.informational + dispositions.excluded;

  // Group by route for summary
  const routeMap = new Map<string, Affordance[]>();
  for (const a of affordances) {
    const list = routeMap.get(a.route) || [];
    list.push(a);
    routeMap.set(a.route, list);
  }

  const byRoute = [...routeMap.entries()].map(([route, affs]) => ({
    route,
    raw: affs.length, // after dedup this is the per-route count
    deduplicated: affs.length,
    executable: affs.filter(a => a.disposition === 'executable').length,
    blocked: affs.filter(a => a.disposition === 'blocked').length,
    grouped: affs.filter(a => a.disposition === 'grouped').length,
    informational: affs.filter(a => a.disposition === 'informational').length,
    excluded: affs.filter(a => a.disposition === 'excluded').length,
  }));

  return {
    generatedAt: new Date().toISOString(),
    discoveredRaw: rawCount,
    deduplicatedTo: deduplicatedCount,
    accountedFor,
    unaccounted: deduplicatedCount - accountedFor,
    dispositions,
    byRoute,
    affordances,
  };
}

export function writeLedger(ledger: AffordanceLedger, outputPath: string): void {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(ledger, null, 2));

  console.log(`\n📊 Affordance Ledger → ${outputPath}`);
  console.log(`   Raw discovered: ${ledger.discoveredRaw}`);
  console.log(`   Deduplicated:   ${ledger.deduplicatedTo}`);
  console.log(`   Accounted:      ${ledger.accountedFor}`);
  console.log(`   Unaccounted:    ${ledger.unaccounted}`);
  console.log(`   ─────────────────────────`);
  console.log(`   Executable:     ${ledger.dispositions.executable}`);
  console.log(`   Blocked:        ${ledger.dispositions.blocked}`);
  console.log(`   Informational:  ${ledger.dispositions.informational}`);
  console.log(`   Grouped:        ${ledger.dispositions.grouped}`);
  console.log(`   Excluded:       ${ledger.dispositions.excluded}`);

  if (ledger.unaccounted > 0) {
    console.log(`\n   ❌ ${ledger.unaccounted} unaccounted affordances!`);
  } else {
    console.log(`\n   ✅ All affordances accounted for.`);
  }
}
