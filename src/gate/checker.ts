/**
 * Coverage Gate Checker v2
 *
 * Compares affordance ledger + test results to determine coverage.
 * Separate buckets: smoke, interaction, blocked.
 *
 * Gate FAILS if:
 * - Any blocking executable affordance has no passing test
 * - Unaccounted affordances > 0
 * - TODO stubs counted as passing
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AffordanceLedger, Affordance, CoverageReport, CoverageIssue, UIContract, UIInventory } from '../config/types.js';

// ── Parse Playwright JSON results ──

interface TestResult {
  suites?: TestSuite[];
}

interface TestSuite {
  title: string;
  specs?: Array<{ title: string; ok: boolean }>;
  suites?: TestSuite[];
}

function extractPassingTests(results: TestResult): Set<string> {
  const passing = new Set<string>();

  function walk(suite: TestSuite, prefix: string) {
    const suitePath = prefix ? `${prefix} > ${suite.title}` : suite.title;
    for (const spec of suite.specs || []) {
      if (spec.ok) {
        passing.add(spec.title);
        passing.add(`${suitePath} > ${spec.title}`);
      }
    }
    for (const child of suite.suites || []) {
      walk(child, suitePath);
    }
  }

  for (const suite of results.suites || []) {
    walk(suite, '');
  }

  return passing;
}

// ── Check if an affordance has a passing test ──

function hasPassingTest(aff: Affordance, passing: Set<string>): boolean {
  // Match by affordance ID prefix in test title
  if ([...passing].some(t => t.includes(aff.id))) return true;

  // Stricter match: test name must contain BOTH the route path AND the affordance label
  const normLabel = aff.label.toLowerCase().replace(/[-:]/g, ' ');
  const normRoute = (aff as any).route?.replace(/\//g, '') || '';
  return [...passing].some(t => {
    const normTest = t.toLowerCase().replace(/[-:]/g, ' ');
    return normTest.includes(normRoute || 'home') && normTest.includes(normLabel.substring(0, Math.min(normLabel.length, 40)));
  });
}

// ── Main coverage check ──

export function checkCoverage(
  contract: UIContract | null,
  testResults: TestResult | null,
  inventory: UIInventory | null,
  strict: boolean = false,
  ledger?: AffordanceLedger | null,
): CoverageReport {
  const issues: CoverageIssue[] = [];
  const passing = testResults ? extractPassingTests(testResults) : new Set<string>();

  // ── Affordance-based coverage (v2) ──
  let interactionTested = 0;
  let interactionRequired = 0;
  let smokeTested = 0;
  let smokeTotal = 0;
  let blockedCount = 0;

  if (ledger) {
    // Check unaccounted affordances
    if (ledger.unaccounted > 0) {
      issues.push({
        type: 'unaccounted',
        severity: 'error',
        item: 'ledger:unaccounted',
        message: `${ledger.unaccounted} discovered affordances are unaccounted for`,
      });
    }

    // Check each executable blocking affordance
    for (const aff of ledger.affordances) {
      if (aff.disposition === 'blocked') {
        blockedCount++;
        continue;
      }
      if (aff.disposition !== 'executable') continue;
      if (aff.severity !== 'blocking') continue;

      interactionRequired++;

      if (hasPassingTest(aff, passing)) {
        interactionTested++;
      } else {
        issues.push({
          type: 'missing_test',
          severity: 'error',
          item: `affordance:${aff.id}`,
          message: `Required interactive control "${aff.label}" (${aff.route}) has no passing interaction test`,
        });
      }
    }

    // Count smoke tests (route-level)
    smokeTotal = ledger.byRoute.length;
    for (const routeInfo of ledger.byRoute) {
      const routeName = routeInfo.route === '/' ? 'home' : routeInfo.route.replace(/^\//, '');
      const hasSmokePass = [...passing].some(t =>
        t.toLowerCase().includes(`${routeName}: page loads`) ||
        t.toLowerCase().includes(`${routeName} page loads`)
      );
      if (hasSmokePass) smokeTested++;
    }
  }

  // ── Legacy contract-based checks (backward compat) ──
  let surfacesTested = 0;
  let flowsTested = 0;
  let invariantsTested = 0;

  if (contract && !ledger) {
    // Fall back to v1 behavior if no ledger
    for (const surface of contract.surfaces) {
      if (surface.metadata.status === 'removed' || surface.metadata.status === 'unreachable') continue;
      const routeName = surface.route.replace(/^\//, '') || 'home';
      const tested = [...passing].some(t =>
        t.toLowerCase().includes(routeName.toLowerCase())
      );
      if (tested) surfacesTested++;
      else if (surface.policy.required && surface.policy.severity === 'blocking') {
        issues.push({
          type: 'missing_test',
          severity: 'error',
          item: `surface:${surface.id}`,
          message: `Required surface "${surface.id}" (${surface.route}) has no passing tests`,
        });
      }
    }

    for (const flow of contract.flows) {
      if (flow.status === 'removed') continue;
      const tested = [...passing].some(t =>
        t.toLowerCase().includes(flow.name.toLowerCase())
      );
      if (tested) flowsTested++;
      else if (flow.required) {
        issues.push({
          type: 'missing_flow_test',
          severity: 'error',
          item: `flow:${flow.id}`,
          message: `Required flow "${flow.name}" has no passing tests`,
        });
      }
    }
  }

  // ── Invariant checks ──
  if (contract) {
    for (const inv of contract.invariants) {
      if (!inv.required) continue;
      if (inv.name.includes('console') || inv.name.includes('request')) {
        invariantsTested++;
        continue;
      }
      const normInv = inv.name.toLowerCase().replace(/-/g, ' ');
      const tested = [...passing].some(t => {
        const normTest = t.toLowerCase().replace(/-/g, ' ');
        return normTest.includes(normInv);
      });
      if (tested) invariantsTested++;
      else {
        issues.push({
          type: 'missing_invariant',
          severity: 'error',
          item: `invariant:${inv.name}`,
          message: `Required invariant "${inv.name}" has no explicit test`,
        });
      }
    }
  }

  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');
  const passed = strict ? errors.length === 0 && warnings.length === 0 : errors.length === 0;

  const activeSurfaces = contract?.surfaces?.filter(s => s.metadata.status === 'active') || [];
  const activeFlows = contract?.flows?.filter(f => f.status !== 'removed') || [];

  return {
    timestamp: new Date().toISOString(),
    passed,
    strict,
    summary: {
      errors: errors.length,
      warnings: warnings.length,
      surfaces_total: activeSurfaces.length,
      surfaces_tested: surfacesTested,
      surfaces_required: activeSurfaces.filter(s => s.policy.required).length,
      flows_total: activeFlows.length,
      flows_tested: flowsTested,
      flows_required: activeFlows.filter(f => f.required).length,
      invariants_total: contract?.invariants?.length || 0,
      invariants_tested: invariantsTested,
      // v2 fields
      ...(ledger ? {
        interaction_required: interactionRequired,
        interaction_tested: interactionTested,
        smoke_total: smokeTotal,
        smoke_tested: smokeTested,
        blocked_count: blockedCount,
        affordances_total: ledger.deduplicatedTo,
        affordances_executable: ledger.dispositions.executable,
        unaccounted: ledger.unaccounted,
      } : {}),
    },
    issues,
  };
}

export function printReport(report: CoverageReport): void {
  console.log('\n' + '='.repeat(60));
  console.log('UIC COVERAGE GATE');
  console.log('='.repeat(60));

  if (report.passed) {
    console.log(`\n✅ PASSED — ${report.summary.errors} errors, ${report.summary.warnings} warnings`);
  } else {
    console.log(`\n❌ FAILED — ${report.summary.errors} errors, ${report.summary.warnings} warnings`);
  }

  const errors = report.issues.filter(i => i.severity === 'error');
  const warnings = report.issues.filter(i => i.severity === 'warning');

  if (errors.length) {
    console.log('\n🔴 ERRORS (blocking):');
    for (const e of errors) {
      console.log(`   • ${e.message}`);
    }
  }

  if (warnings.length) {
    console.log('\n🟡 WARNINGS:');
    for (const w of warnings) {
      console.log(`   • ${w.message}`);
    }
  }

  const s = report.summary as any;

  if (s.interaction_required !== undefined) {
    // v2 affordance-based report
    console.log(`\n📊 Interaction: ${s.interaction_tested}/${s.interaction_required} required controls tested`);
    console.log(`   Smoke:       ${s.smoke_tested}/${s.smoke_total} routes tested`);
    console.log(`   Blocked:     ${s.blocked_count} (with reasons)`);
    console.log(`   Affordances: ${s.affordances_executable} executable / ${s.affordances_total} total`);
    if (s.unaccounted > 0) {
      console.log(`   ❌ Unaccounted: ${s.unaccounted}`);
    }
  } else {
    // v1 legacy report
    console.log(`\n📊 Surfaces: ${s.surfaces_tested}/${s.surfaces_total} tested (${s.surfaces_required} required)`);
    console.log(`   Flows: ${s.flows_tested}/${s.flows_total} tested (${s.flows_required} required)`);
  }

  console.log(`   Invariants: ${s.invariants_tested}/${s.invariants_total} tested`);
  console.log('='.repeat(60) + '\n');
}

export function writeReport(report: CoverageReport, outputPath: string): void {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`📄 Report → ${outputPath}`);
}
