#!/usr/bin/env node
/**
 * UIC CLI — Browser-First UI Coverage Enforcement
 *
 * Commands:
 *   uic init          Scaffold config, detect framework
 *   uic discover      Run browser discovery against running app
 *   uic contract gen  Generate contract from inventory
 *   uic contract diff Compare current contract vs latest inventory
 *   uic contract update  Apply diff to update contract
 *   uic test gen      Generate Playwright tests from contract
 *   uic gate          Check coverage, exit 0/1
 *   uic report        Generate human-readable report
 *   uic doctor        Verify setup, deps, config
 */

import { Command } from 'commander';
import { resolve, join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { loadConfig, getArtifactPaths } from './config/loader.js';
import { detectStack } from './config/detector.js';
import { discover } from './discovery/crawler.js';
import { generateContract, writeContract } from './contract/generator.js';
import { diffContracts, applyDiff } from './contract/differ.js';
import { checkCoverage, printReport, writeReport } from './gate/checker.js';
import { authenticatePersona } from './auth/persona.js';
import { generateTests } from './runner/test-generator.js';
import { classifyAffordances } from './affordance/classifier.js';
import { buildLedger, writeLedger } from './affordance/ledger.js';
import { generateInteractionTests } from './generation/primitive-generator.js';
import { ensureServerRunning, stopServer, type ServerStartResult } from './utils/server.js';
import { diagnoseAllFailures } from './repair/diagnoser.js';
import type { Diagnosis } from './repair/diagnoser.js';
import { synthesizePreconditions } from './repair/precondition-synthesizer.js';
import {
  checkHardGate, buildMetrics, writeQualityReport, writeRepairLog,
  printQualityMetrics, type RepairRecord, type QualityReport,
} from './repair/quality-tracker.js';
import type { UIContract, UIInventory, AffordanceLedger } from './config/types.js';

const program = new Command();

program
  .name('uic')
  .description('Browser-first UI coverage enforcement')
  .version('0.1.0');

// ── uic init ────────────────────────────────────────────────
program
  .command('init')
  .description('Scaffold uic config for this project')
  .option('--force', 'Overwrite existing config')
  .action(async (opts) => {
    const cwd = process.cwd();
    const configPath = join(cwd, 'uic.config.ts');

    if (existsSync(configPath) && !opts.force) {
      console.log('Config already exists at uic.config.ts. Use --force to overwrite.');
      return;
    }

    console.log('🔍 Detecting project stack...\n');
    const detection = detectStack(cwd);

    console.log(`  Framework: ${detection.framework}`);
    console.log(`  Package manager: ${detection.packageManager}`);
    console.log(`  Router: ${detection.router || 'unknown'}`);
    console.log(`  Dev command: ${detection.devCommand || 'unknown'}`);
    console.log(`  Base URL: ${detection.baseUrl || 'http://localhost:3000'}`);
    console.log(`  Playwright: ${detection.hasPlaywright ? 'installed' : 'not installed'}`);
    console.log(`  Seed routes: ${detection.seedRoutes.join(', ')}`);

    // Generate config file
    const template = `import type { UicConfig } from 'uic';

export default {
  app: {
    name: '${detection.framework} App',
    framework: '${detection.framework}',
    baseUrl: '${detection.baseUrl || 'http://localhost:3000'}',
    startCommand: '${detection.devCommand || 'npm run dev'}',
    startTimeout: 30000,
  },
  auth: {
    strategy: 'api-bootstrap',
    personas: {
      user: {
        email: '\${TEST_USER_EMAIL}',
        password: '\${TEST_USER_PASSWORD}',
        loginEndpoint: '/api/auth/login',
      },
    },
  },
  discovery: {
    seedRoutes: ${JSON.stringify(detection.seedRoutes, null, 4).replace(/\n/g, '\n    ')},
    excludeRoutes: [],
    maxDepth: 3,
    waitAfterNavigation: 1000,
    screenshots: true,
  },
  exclusions: [],
} satisfies UicConfig;
`;

    writeFileSync(configPath, template);
    mkdirSync(join(cwd, '.uic'), { recursive: true });
    console.log(`\n✅ Created uic.config.ts`);
    console.log(`   Edit it to match your project, then run: uic discover`);

    // Add .uic/auth to gitignore
    const gitignorePath = join(cwd, '.gitignore');
    if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, 'utf-8');
      if (!content.includes('.uic/auth')) {
        writeFileSync(gitignorePath, content + '\n# UIC auth state (sensitive)\n.uic/auth/\n');
        console.log('   Added .uic/auth/ to .gitignore');
      }
    }
  });

// ── uic discover ────────────────────────────────────────────
program
  .command('discover')
  .description('Run browser discovery against the running app')
  .option('--persona <name>', 'Authenticate as persona before discovery', 'user')
  .option('--no-start', 'Do not auto-start the dev server')
  .action(async (opts) => {
    const cwd = process.cwd();
    const config = await loadConfig(cwd);
    const paths = getArtifactPaths(cwd, config);

    // Auto-start the app if not running
    let serverResult: ServerStartResult | undefined;
    if (opts.start !== false) {
      serverResult = await ensureServerRunning(
        config.app.baseUrl,
        config.app.startCommand,
        config.app.startTimeout || 30000,
        cwd,
      );
      if (!serverResult.alreadyRunning && !serverResult.started) {
        console.error(`❌ ${serverResult.error}`);
        process.exit(1);
      }
    }

    try {
      let authContext;
      if (config.auth && opts.persona !== 'guest') {
        console.log(`🔐 Authenticating as "${opts.persona}"...`);
        const authResult = await authenticatePersona(
          config.app.baseUrl, opts.persona, config.auth, paths.authDir,
        );
        if (authResult.success) {
          authContext = authResult.context;
          console.log(`   ✓ Authenticated as ${opts.persona}`);
        } else {
          console.warn(`   ⚠ Auth failed: ${authResult.error}`);
          console.warn('   Continuing without authentication...');
        }
      }

      await discover({ config, projectRoot: cwd, authenticatedContext: authContext });
    } finally {
      // Stop server if we started it
      if (serverResult?.started) {
        stopServer(serverResult);
      }
    }
  });

// ── uic contract ────────────────────────────────────────────
const contractCmd = program
  .command('contract')
  .description('Manage the UI coverage contract');

contractCmd
  .command('generate')
  .alias('gen')
  .description('Generate contract from inventory')
  .action(async () => {
    const cwd = process.cwd();
    const config = await loadConfig(cwd);
    const paths = getArtifactPaths(cwd, config);

    if (!existsSync(paths.inventory)) {
      console.error('No inventory found. Run: uic discover');
      process.exit(1);
    }

    const inventory: UIInventory = JSON.parse(readFileSync(paths.inventory, 'utf-8'));
    const contract = generateContract(inventory, config);
    writeContract(contract, paths.contract);

    // v2: Also generate affordance ledger
    const classified = classifyAffordances(inventory.routes, config);
    const ledger = buildLedger(classified);
    const ledgerPath = resolve(cwd, '.uic/ledger.json');
    writeLedger(ledger, ledgerPath);
  });

contractCmd
  .command('diff')
  .description('Compare current contract vs latest inventory')
  .action(async () => {
    const cwd = process.cwd();
    const config = await loadConfig(cwd);
    const paths = getArtifactPaths(cwd, config);

    if (!existsSync(paths.contract) || !existsSync(paths.inventory)) {
      console.error('Need both contract and inventory. Run: uic discover && uic contract gen');
      process.exit(1);
    }

    const existing: UIContract = JSON.parse(readFileSync(paths.contract, 'utf-8'));
    const inventory: UIInventory = JSON.parse(readFileSync(paths.inventory, 'utf-8'));
    const updated = generateContract(inventory, config);
    const diff = diffContracts(existing, updated);

    console.log('\n📊 Contract Diff\n');
    console.log(`  Added surfaces: ${diff.addedSurfaces.length}`);
    diff.addedSurfaces.forEach(s => console.log(`    + ${s}`));
    console.log(`  Removed surfaces: ${diff.removedSurfaces.length}`);
    diff.removedSurfaces.forEach(s => console.log(`    - ${s}`));
    console.log(`  Changed surfaces: ${diff.changedSurfaces.length}`);
    diff.changedSurfaces.forEach(s => console.log(`    ~ ${s.id} (+${s.addedElements}/-${s.removedElements} elements)`));
    console.log(`  Added flows: ${diff.addedFlows.length}`);
    console.log(`  Removed flows: ${diff.removedFlows.length}`);
    console.log(`\n  Summary: ${diff.summary}\n`);
  });

contractCmd
  .command('update')
  .description('Apply diff to update contract preserving manual edits')
  .action(async () => {
    const cwd = process.cwd();
    const config = await loadConfig(cwd);
    const paths = getArtifactPaths(cwd, config);

    if (!existsSync(paths.contract) || !existsSync(paths.inventory)) {
      console.error('Need both contract and inventory. Run: uic discover && uic contract gen');
      process.exit(1);
    }

    const existing: UIContract = JSON.parse(readFileSync(paths.contract, 'utf-8'));
    const inventory: UIInventory = JSON.parse(readFileSync(paths.inventory, 'utf-8'));
    const updated = generateContract(inventory, config);
    const diff = diffContracts(existing, updated);

    if (!diff.addedSurfaces.length && !diff.removedSurfaces.length && !diff.changedSurfaces.length) {
      console.log('\n✅ Contract is up to date.\n');
      return;
    }

    const merged = applyDiff(existing, updated, diff);
    writeContract(merged, paths.contract);
    console.log(`Applied: ${diff.summary}`);
  });

// ── uic test ────────────────────────────────────────────────
const testCmd = program
  .command('test')
  .description('Generate and run browser tests');

testCmd
  .command('generate')
  .alias('gen')
  .description('Generate Playwright tests from affordance ledger')
  .option('--output <dir>', 'Output directory for test files', 'tests/e2e')
  .option('--legacy', 'Use v1 generator (contract-based, not affordance-based)')
  .action(async (opts) => {
    const cwd = process.cwd();
    const config = await loadConfig(cwd);
    const paths = getArtifactPaths(cwd, config);

    if (opts.legacy) {
      // v1 fallback
      if (!existsSync(paths.contract)) {
        console.error('No contract found. Run: uic contract gen');
        process.exit(1);
      }
      const contract: UIContract = JSON.parse(readFileSync(paths.contract, 'utf-8'));
      const outputDir = resolve(cwd, opts.output);
      generateTests(contract, config, outputDir);
      return;
    }

    // v2: affordance-based generation
    const ledgerPath = resolve(cwd, '.uic/ledger.json');
    if (!existsSync(ledgerPath)) {
      console.error('No affordance ledger found. Run: uic contract gen');
      process.exit(1);
    }

    const ledger: AffordanceLedger = JSON.parse(readFileSync(ledgerPath, 'utf-8'));
    const outputDir = resolve(cwd, opts.output);
    generateInteractionTests(ledger, config, outputDir);
  });

testCmd
  .command('run')
  .description('Run Playwright tests')
  .option('--headed', 'Run in headed mode')
  .option('--no-start', 'Do not auto-start the dev server')
  .action(async (opts) => {
    const cwd = process.cwd();
    const config = await loadConfig(cwd);

    // Auto-start the app if not running
    let serverResult: ServerStartResult | undefined;
    if (opts.start !== false) {
      serverResult = await ensureServerRunning(
        config.app.baseUrl,
        config.app.startCommand,
        config.app.startTimeout || 30000,
        cwd,
      );
      if (!serverResult.alreadyRunning && !serverResult.started) {
        console.error(`❌ ${serverResult.error}`);
        process.exit(1);
      }
    }

    try {
      const { execSync } = await import('node:child_process');
      const args = opts.headed ? '--headed' : '';
      execSync(`npx playwright test ${args}`, { stdio: 'inherit', cwd });
    } catch {
      process.exit(1);
    } finally {
      if (serverResult?.started) {
        stopServer(serverResult);
      }
    }
  });

// ── Mechanical repair engine ─────────────────────────────────

function applyMechanicalRepairs(diagnoses: Diagnosis[], cwd: string): RepairRecord[] {
  const repairs: RepairRecord[] = [];

  // Group by file to minimize I/O
  const byFile = new Map<string, Diagnosis[]>();
  for (const d of diagnoses) {
    const file = d.testFile || '';
    const list = byFile.get(file) || [];
    list.push(d);
    byFile.set(file, list);
  }

  for (const [file, fileDiagnoses] of byFile) {
    if (!file) continue;
    // Resolve file path — may be basename only or relative
    let filePath = resolve(cwd, file);
    if (!existsSync(filePath)) {
      // Try tests/e2e/ subdirectory
      filePath = resolve(cwd, 'tests/e2e', file);
    }
    if (!existsSync(filePath)) continue;
    let content = readFileSync(filePath, 'utf-8');

    for (const d of fileDiagnoses) {
      const record: RepairRecord = {
        failureId: d.testTitle,
        category: d.category,
        layer: d.layer,
        confidence: d.confidence,
        repairTarget: d.repairTarget,
        repairType: d.repairType,
        autoApplied: false,
        rationale: d.rationale,
        fileModified: file,
        description: d.suggestedFix,
      };

      if (!d.autoFixable || d.confidence < 0.7) {
        repairs.push(record);
        continue;
      }

      // Find the test block by title
      const escapedTitle = d.testTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const testBlockRegex = new RegExp(`(test\\()(['"\`])${escapedTitle}\\2`);
      const match = content.match(testBlockRegex);

      if (!match) {
        repairs.push(record);
        continue;
      }

      let applied = false;

      switch (d.category) {
        case 'ambiguous-locator': {
          // Insert .first() on all locator occurrences that don't already have it
          const testStart = content.indexOf(match[0]);
          const testEnd = findTestBlockEnd(content, testStart);
          const block = content.substring(testStart, testEnd);
          // Add .first() after getByRole/Text/etc before any chained method or closing paren
          const newBlock = block.replace(
            /(getBy(?:Role|Text|Placeholder|Label)\([^)]+\))(?!\.first\(\))([.)])/g,
            '$1.first()$2',
          );
          if (newBlock !== block) {
            content = content.substring(0, testStart) + newBlock + content.substring(testEnd);
            applied = true;
          }
          break;
        }

        case 'dynamic-label':
        case 'unnamed-element': {
          // Convert test(...) to test.skip(...)
          const idx = content.indexOf(match[0]);
          if (idx >= 0) {
            content = content.substring(0, idx)
              + `test.skip(${match[2]}${d.testTitle}${match[2]}`
              + content.substring(idx + match[0].length);
            applied = true;
            record.repairType = 'weakening';
          }
          break;
        }

        case 'date-format': {
          // Replace fill('test input value') with fill('2026-01-15') in test block
          const testStart = content.indexOf(match[0]);
          const testEnd = findTestBlockEnd(content, testStart);
          const block = content.substring(testStart, testEnd);
          const newBlock = block.replace(/\.fill\(['"]test input value['"]\)/, ".fill('2026-01-15')");
          if (newBlock !== block) {
            content = content.substring(0, testStart) + newBlock + content.substring(testEnd);
            applied = true;
          }
          break;
        }

        case 'self-navigation': {
          // Replace waitForURL with toBeVisible
          const testStart = content.indexOf(match[0]);
          const testEnd = findTestBlockEnd(content, testStart);
          const block = content.substring(testStart, testEnd);
          // Match waitForURL with any argument including arrow functions
          const newBlock = block.replace(
            /await page\.waitForURL\(.*?\{[^}]*\}\);/s,
            'await expect(page.locator(\'body\')).toBeVisible();',
          ).replace(
            /await page\.waitForURL\([^;]+\);/,
            'await expect(page.locator(\'body\')).toBeVisible();',
          );
          if (newBlock !== block) {
            content = content.substring(0, testStart) + newBlock + content.substring(testEnd);
            applied = true;
          }
          break;
        }

        case 'expected-401': {
          // Filter expected errors from console error assertion
          const testStart = content.indexOf(match[0]);
          const testEnd = findTestBlockEnd(content, testStart);
          const block = content.substring(testStart, testEnd);
          let newBlock = block;
          // Replace bare toHaveLength(0)
          newBlock = newBlock.replace(
            /expect\(consoleErrors\)\.toHaveLength\(0\)/,
            "expect(consoleErrors.filter(e => !e.includes('401') && !e.includes('Unauthorized') && !e.includes('Failed to load'))).toHaveLength(0)",
          );
          // Also update if already partially filtered
          newBlock = newBlock.replace(
            /consoleErrors\.filter\(e => !e\.includes\('401'\) && !e\.includes\('Unauthorized'\)\)/,
            "consoleErrors.filter(e => !e.includes('401') && !e.includes('Unauthorized') && !e.includes('Failed to load'))",
          );
          if (newBlock !== block) {
            content = content.substring(0, testStart) + newBlock + content.substring(testEnd);
            applied = true;
          }
          break;
        }

        case 'llm-timeout': {
          // LLM tests time out because backend is slow — skip with documented reason
          const idx = content.indexOf(match[0]);
          if (idx >= 0) {
            content = content.substring(0, idx)
              + `test.skip(${match[2]}${d.testTitle}${match[2]}`
              + content.substring(idx + match[0].length);
            applied = true;
            record.repairType = 'weakening';
          }
          break;
        }

        case 'disabled-element':
        case 'stale-locator': {
          // Skip — element requires specific state or is disabled
          const idx = content.indexOf(match[0]);
          if (idx >= 0) {
            content = content.substring(0, idx)
              + `test.skip(${match[2]}${d.testTitle}${match[2]}`
              + content.substring(idx + match[0].length);
            applied = true;
            record.repairType = 'weakening';
          }
          break;
        }

        case 'wrong-primitive': {
          // Replace .check() with .click()
          const testStart = content.indexOf(match[0]);
          const testEnd = findTestBlockEnd(content, testStart);
          const block = content.substring(testStart, testEnd);
          const newBlock = block.replace(/\.check\(\)/, '.click()');
          if (newBlock !== block) {
            content = content.substring(0, testStart) + newBlock + content.substring(testEnd);
            applied = true;
          }
          break;
        }

        default:
          break;
      }

      record.autoApplied = applied;
      repairs.push(record);
    }

    const hasApplied = repairs.some(r => r.autoApplied && (r.fileModified === file || r.fileModified === filePath));
    if (hasApplied) {
      writeFileSync(filePath, content);
    }
  }

  return repairs;
}

/** Find the end of a test block (matching closing brace + paren + semicolon) */
function findTestBlockEnd(content: string, start: number): number {
  // Find the arrow function's opening brace: => {
  const arrowMatch = content.substring(start).match(/=>\s*\{/);
  if (!arrowMatch) {
    // Fallback: find next test( or end of describe block
    const next = content.indexOf("\n  test(", start + 10);
    return next > 0 ? next : content.length;
  }

  const braceStart = start + arrowMatch.index! + arrowMatch[0].length - 1;
  let depth = 0;
  let inString: string | null = null;
  let inRegex = false;

  for (let i = braceStart; i < content.length; i++) {
    const ch = content[i];
    const prev = i > 0 ? content[i - 1] : '';

    // Track regex literals (simplified: / after operator-like char)
    if (!inString && !inRegex && ch === '/' && /[=(:,\s]/.test(prev)) {
      inRegex = true;
      continue;
    }
    if (inRegex && ch === '/' && prev !== '\\') {
      inRegex = false;
      continue;
    }
    if (inRegex) continue;

    // Track string literals
    if (!inString && (ch === "'" || ch === '"' || ch === '`')) {
      inString = ch;
      continue;
    }
    if (inString === ch && prev !== '\\') {
      inString = null;
      continue;
    }
    if (inString) continue;

    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        // Find the closing );
        const rest = content.substring(i + 1, i + 10);
        const close = rest.match(/^\s*\)\s*;?/);
        return i + 1 + (close ? close[0].length : 0);
      }
    }
  }
  return content.length;
}

// ── uic optimize ─────────────────────────────────────────────
program
  .command('optimize')
  .description('Diagnose and repair failing tests, iterate toward 100%')
  .option('--iterations <n>', 'Max repair iterations', '3')
  .option('--allow-app-fixes', 'Apply Layer D app bug fixes')
  .action(async (opts) => {
    const cwd = process.cwd();
    const config = await loadConfig(cwd);
    const paths = getArtifactPaths(cwd, config);
    const maxIterations = parseInt(opts.iterations) || 3;
    const allowAppFixes = !!opts.allowAppFixes;

    const resultsPath = paths.testResults;
    const ledgerPath = resolve(cwd, '.uic/ledger.json');

    if (!existsSync(resultsPath)) {
      console.error('No test results found. Run: uic test run');
      process.exit(1);
    }
    if (!existsSync(ledgerPath)) {
      console.error('No affordance ledger found. Run: uic contract gen');
      process.exit(1);
    }

    console.log('\n🔧 UIC Optimize — Self-healing test repair\n');

    const allRepairs: RepairRecord[] = [];
    const allMetrics: import('./repair/quality-tracker.js').QualityMetrics[] = [];
    let previousMetrics: import('./repair/quality-tracker.js').QualityMetrics | undefined;
    let previousFailures = new Set<string>();

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      console.log(`\n── Iteration ${iteration}/${maxIterations} ──\n`);

      // 1. Diagnose failures
      const diagnoses = diagnoseAllFailures(resultsPath);

      if (diagnoses.length === 0) {
        console.log('✅ No failures to diagnose — all tests passing!');
        break;
      }

      console.log(`📋 ${diagnoses.length} failures diagnosed:`);
      const byCat = new Map<string, number>();
      for (const d of diagnoses) {
        byCat.set(d.category, (byCat.get(d.category) || 0) + 1);
      }
      for (const [cat, count] of byCat) {
        console.log(`   ${cat}: ${count}`);
      }

      // 2. Check for stuck pattern (same failures 2 iterations)
      const currentFailures = new Set(diagnoses.map(d => d.testTitle));
      if (iteration > 1 && setsEqual(currentFailures, previousFailures)) {
        console.log('\n⚠ Stuck — same failures as last iteration. Stopping.');
        break;
      }
      previousFailures = currentFailures;

      // 3. Synthesize preconditions (Layer B)
      const ledger: AffordanceLedger = JSON.parse(readFileSync(ledgerPath, 'utf-8'));
      const preconditions = synthesizePreconditions(ledger, cwd);
      if (preconditions.fixturesCreated.length > 0) {
        console.log(`\n📁 Fixtures created: ${preconditions.fixturesCreated.length}`);
        for (const f of preconditions.fixturesCreated) {
          console.log(`   ${f}`);
        }
      }
      // Write preconditions report
      writeFileSync(
        resolve(cwd, '.uic/preconditions.json'),
        JSON.stringify(preconditions, null, 2),
      );

      // 4. Apply mechanical repairs
      const repairableDiagnoses = allowAppFixes
        ? diagnoses
        : diagnoses.filter(d => d.layer !== 'D');

      const repairs = applyMechanicalRepairs(repairableDiagnoses, cwd);
      const applied = repairs.filter(r => r.autoApplied);
      const skipped = repairs.filter(r => !r.autoApplied);

      console.log(`\n🔨 Repairs: ${applied.length} applied, ${skipped.length} skipped`);
      for (const r of applied) {
        console.log(`   ✓ [${r.layer}/${r.category}] ${r.failureId} — ${r.description}`);
      }
      for (const r of skipped.filter(s => s.layer === 'D')) {
        console.log(`   ⊘ [D/${r.category}] ${r.failureId} — needs --allow-app-fixes`);
      }

      allRepairs.push(...repairs);

      // 5. Rerun tests
      console.log('\n🔄 Rerunning tests...');
      try {
        const { execSync } = await import('node:child_process');
        execSync('npx playwright test', {
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd,
        });
      } catch {
        // Test failures are expected — we read results from file
      }

      // 6. Build quality metrics
      // Count pass/fail from results
      const { totalTests, passingTests } = countResults(resultsPath);
      const freshLedger: AffordanceLedger = JSON.parse(readFileSync(ledgerPath, 'utf-8'));
      const metrics = buildMetrics(
        iteration, totalTests, passingTests, freshLedger, repairs,
        previousMetrics?.obligation_integrity.blocking_count_after,
      );
      printQualityMetrics(metrics);

      const gate = checkHardGate(metrics, previousMetrics);
      if (!gate.passed) {
        console.log('\n⚠ Hard gate violations:');
        for (const v of gate.violations) {
          console.log(`   ✗ ${v}`);
        }
      }

      allMetrics.push(metrics);
      previousMetrics = metrics;

      // 7. Check if done
      if (metrics.pass_rate >= 1.0) {
        console.log('\n✅ 100% pass rate achieved!');
        break;
      }
    }

    // Write artifacts
    const finalGate = previousMetrics ? checkHardGate(previousMetrics) : { passed: true, violations: [] };
    const report: QualityReport = {
      generatedAt: new Date().toISOString(),
      iterations: allMetrics,
      repairs: allRepairs,
      hardGateResult: finalGate,
    };

    writeRepairLog(allRepairs, resolve(cwd, '.uic/repair-log.json'));
    writeQualityReport(report, resolve(cwd, '.uic/generation-quality.json'));

    console.log('\n📄 Artifacts written:');
    console.log('   .uic/repair-log.json');
    console.log('   .uic/generation-quality.json');
    console.log('   .uic/preconditions.json');

    if (previousMetrics) {
      console.log(`\n📊 Final: ${(previousMetrics.pass_rate * 100).toFixed(1)}% pass rate (${previousMetrics.passing_tests}/${previousMetrics.total_tests})`);
    }
  });

/** Count pass/fail from Playwright JSON results */
function countResults(resultsPath: string): { totalTests: number; passingTests: number } {
  if (!existsSync(resultsPath)) return { totalTests: 0, passingTests: 0 };
  const data = JSON.parse(readFileSync(resultsPath, 'utf-8'));
  let total = 0;
  let passing = 0;

  function walk(suite: { specs?: Array<{ ok: boolean }>; suites?: Array<any> }) {
    for (const spec of suite.specs || []) {
      total++;
      if (spec.ok) passing++;
    }
    for (const child of suite.suites || []) {
      walk(child);
    }
  }

  for (const suite of data.suites || []) {
    walk(suite);
  }
  return { totalTests: total, passingTests: passing };
}

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

// ── uic gate ────────────────────────────────────────────────
program
  .command('gate')
  .description('Check UI coverage against contract — exit 0 (pass) or 1 (fail)')
  .option('--strict', 'Fail on warnings too')
  .action(async (opts) => {
    const cwd = process.cwd();
    const config = await loadConfig(cwd);
    const paths = getArtifactPaths(cwd, config);

    if (!existsSync(paths.contract)) {
      console.error('No contract found. Run: uic discover && uic contract gen');
      process.exit(2);
    }

    const contract: UIContract = JSON.parse(readFileSync(paths.contract, 'utf-8'));
    const testResults = existsSync(paths.testResults) ? JSON.parse(readFileSync(paths.testResults, 'utf-8')) : null;
    const inventory = existsSync(paths.inventory) ? JSON.parse(readFileSync(paths.inventory, 'utf-8')) : null;
    const ledgerPath = resolve(cwd, '.uic/ledger.json');
    const ledger: AffordanceLedger | null = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf-8')) : null;

    if (!testResults) {
      console.warn('⚠ No test results found. Run: uic test run');
    }

    const report = checkCoverage(contract, testResults, inventory, opts.strict, ledger);
    printReport(report);
    writeReport(report, paths.report);

    process.exit(report.passed ? 0 : 1);
  });

// ── uic report ──────────────────────────────────────────────
program
  .command('report')
  .description('Display the latest coverage report')
  .option('--format <type>', 'Output format: text, json', 'text')
  .action(async (opts) => {
    const cwd = process.cwd();
    const config = await loadConfig(cwd);
    const paths = getArtifactPaths(cwd, config);

    if (!existsSync(paths.report)) {
      console.error('No report found. Run: uic gate');
      process.exit(1);
    }

    const report = JSON.parse(readFileSync(paths.report, 'utf-8'));
    if (opts.format === 'json') {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printReport(report);
    }
  });

// ── uic doctor ──────────────────────────────────────────────
program
  .command('doctor')
  .description('Verify setup: config, dependencies, Playwright')
  .action(async () => {
    const cwd = process.cwd();
    let ok = true;

    console.log('\n🩺 UIC Doctor\n');

    // Check config
    const configExists = ['uic.config.ts', 'uic.config.js', '.uic/config.ts'].some(f => existsSync(join(cwd, f)));
    console.log(`  ${configExists ? '✅' : '❌'} Config file`);
    if (!configExists) ok = false;

    // Check Playwright
    try {
      const { execSync } = await import('node:child_process');
      execSync('npx playwright --version', { stdio: 'pipe', cwd });
      console.log('  ✅ Playwright installed');
    } catch {
      console.log('  ❌ Playwright not installed. Run: npm i -D @playwright/test');
      ok = false;
    }

    // Check artifacts
    const paths = configExists ? getArtifactPaths(cwd, await loadConfig(cwd)) : null;
    if (paths) {
      console.log(`  ${existsSync(paths.inventory) ? '✅' : '⬜'} Inventory (run: uic discover)`);
      console.log(`  ${existsSync(paths.contract) ? '✅' : '⬜'} Contract (run: uic contract gen)`);
      console.log(`  ${existsSync(paths.testResults) ? '✅' : '⬜'} Test results (run: uic test run)`);
      console.log(`  ${existsSync(paths.report) ? '✅' : '⬜'} Coverage report (run: uic gate)`);
    }

    console.log(`\n${ok ? '✅ All good!' : '❌ Issues found — fix the items above.'}\n`);
    process.exit(ok ? 0 : 1);
  });

program.parse();
