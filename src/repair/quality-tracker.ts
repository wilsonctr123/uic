/**
 * Quality Tracker
 *
 * Tracks multi-metric quality across optimize loop iterations.
 * Enforces hard rules: no silent weakening, no disappearing obligations,
 * no coverage regression.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AffordanceLedger } from '../config/types.js';
import type { Diagnosis, RepairType } from './diagnoser.js';

export interface QualityMetrics {
  iteration: number;
  timestamp: string;
  pass_rate: number;
  total_tests: number;
  passing_tests: number;
  failing_tests: number;
  interaction_coverage: number;
  blocked_count: number;
  weakened_count: number;
  coverage_removals: number;
  repairs_applied: number;
  avg_repair_confidence: number;
  obligation_integrity: {
    discovered_affordances: number;
    accounted_for_affordances: number;
    executable_obligations: number;
    blocked_obligations: number;
    informational_dispositions: number;
    excluded_dispositions: number;
    unaccounted_for_affordances: number;
    blocking_count_before: number;
    blocking_count_after: number;
  };
}

export interface RepairRecord {
  failureId: string;
  category: string;
  layer: string;
  confidence: number;
  repairTarget: string;
  repairType: RepairType;
  autoApplied: boolean;
  rationale: string;
  fileModified: string;
  description: string;
}

export interface QualityReport {
  generatedAt: string;
  iterations: QualityMetrics[];
  repairs: RepairRecord[];
  hardGateResult: {
    passed: boolean;
    violations: string[];
  };
}

// ── Check hard gate rules ──

export function checkHardGate(
  metrics: QualityMetrics,
  previousMetrics?: QualityMetrics,
): { passed: boolean; violations: string[] } {
  const violations: string[] = [];

  // Rule 1: Unaccounted affordances must be 0
  if (metrics.obligation_integrity.unaccounted_for_affordances > 0) {
    violations.push(`${metrics.obligation_integrity.unaccounted_for_affordances} unaccounted affordances`);
  }

  // Rule 2: Blocking obligations must not silently decrease
  if (previousMetrics) {
    const before = previousMetrics.obligation_integrity.blocking_count_after;
    const after = metrics.obligation_integrity.blocking_count_after;
    if (after < before && metrics.coverage_removals === 0) {
      violations.push(`Blocking obligations decreased from ${before} to ${after} without explicit justification`);
    }
  }

  // Rule 3: No improvement only by weakening
  if (metrics.weakened_count > 0 && metrics.pass_rate > (previousMetrics?.pass_rate || 0)) {
    const passImproved = metrics.passing_tests - (previousMetrics?.passing_tests || 0);
    if (passImproved <= metrics.weakened_count) {
      violations.push(`Pass rate improved only by weakening ${metrics.weakened_count} tests`);
    }
  }

  // Rule 4: Coverage removals must be 0 unless justified
  if (metrics.coverage_removals > 0) {
    violations.push(`${metrics.coverage_removals} coverage removals detected`);
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}

// ── Build metrics from current state ──

export function buildMetrics(
  iteration: number,
  totalTests: number,
  passingTests: number,
  ledger: AffordanceLedger,
  repairs: RepairRecord[],
  previousBlockingCount?: number,
): QualityMetrics {
  const blockingAffordances = ledger.affordances.filter(a =>
    a.disposition === 'executable' && a.severity === 'blocking'
  );
  const testedBlocking = blockingAffordances.filter(a => a.generatedTest).length;

  return {
    iteration,
    timestamp: new Date().toISOString(),
    pass_rate: totalTests > 0 ? passingTests / totalTests : 0,
    total_tests: totalTests,
    passing_tests: passingTests,
    failing_tests: totalTests - passingTests,
    interaction_coverage: blockingAffordances.length > 0
      ? testedBlocking / blockingAffordances.length : 1,
    blocked_count: ledger.dispositions.blocked,
    weakened_count: repairs.filter(r => r.repairType === 'weakening').length,
    coverage_removals: repairs.filter(r => r.repairType === 'coverage-removal').length,
    repairs_applied: repairs.length,
    avg_repair_confidence: repairs.length > 0
      ? repairs.reduce((sum, r) => sum + r.confidence, 0) / repairs.length : 1,
    obligation_integrity: {
      discovered_affordances: ledger.discoveredRaw,
      accounted_for_affordances: ledger.accountedFor,
      executable_obligations: ledger.dispositions.executable,
      blocked_obligations: ledger.dispositions.blocked,
      informational_dispositions: ledger.dispositions.informational,
      excluded_dispositions: ledger.dispositions.excluded,
      unaccounted_for_affordances: ledger.unaccounted,
      blocking_count_before: previousBlockingCount ?? blockingAffordances.length,
      blocking_count_after: blockingAffordances.length,
    },
  };
}

// ── Write reports ──

export function writeQualityReport(report: QualityReport, outputPath: string): void {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(report, null, 2));
}

export function writeRepairLog(repairs: RepairRecord[], outputPath: string): void {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify({ generatedAt: new Date().toISOString(), repairs }, null, 2));
}

export function printQualityMetrics(metrics: QualityMetrics): void {
  console.log(`\n📊 Quality Metrics (Iteration ${metrics.iteration})`);
  console.log(`   Pass rate:           ${(metrics.pass_rate * 100).toFixed(1)}% (${metrics.passing_tests}/${metrics.total_tests})`);
  console.log(`   Interaction coverage: ${(metrics.interaction_coverage * 100).toFixed(1)}%`);
  console.log(`   Blocked:             ${metrics.blocked_count}`);
  console.log(`   Weakened:            ${metrics.weakened_count}`);
  console.log(`   Coverage removals:   ${metrics.coverage_removals}`);
  console.log(`   Repairs applied:     ${metrics.repairs_applied}`);
  console.log(`   Avg confidence:      ${metrics.avg_repair_confidence.toFixed(2)}`);
  console.log(`   Obligation integrity:`);
  console.log(`     Discovered: ${metrics.obligation_integrity.discovered_affordances}`);
  console.log(`     Accounted:  ${metrics.obligation_integrity.accounted_for_affordances}`);
  console.log(`     Unaccounted: ${metrics.obligation_integrity.unaccounted_for_affordances}`);
}
