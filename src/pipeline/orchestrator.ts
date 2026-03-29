/**
 * UIC Pipeline Orchestrator
 *
 * Single-command pipeline that runs the complete UIC flow:
 *   1. UNDERSTAND — read the codebase to build AppUnderstanding
 *   2. DISCOVER  — browser-crawl routes and inventory interactive elements
 *   3. CONTRACT  — generate coverage contract + affordance ledger
 *   4. GENERATE  — produce Playwright test files from the ledger
 *   5. EXECUTE   — run the generated tests via Playwright
 *   6. EVALUATE  — judge AI feature output quality
 *   7. GATE      — check coverage against the contract
 *
 * Delegates to existing CLI commands via execSync so all logic is reused.
 * This is what `npx uic run` (or bare `npx uic`) invokes.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { execSync, type ExecSyncOptions } from 'child_process';
import { fileURLToPath } from 'url';
import { readAppUnderstanding } from '../intelligence/app-reader.js';
import { loadConfig } from '../config/loader.js';
import { generateTestScenarios, generateTestScenariosWithLLM } from '../intelligence/scenario-planner.js';
import { generateIntelligentTests } from '../generation/intelligent-generator.js';
import { createLLMClient } from '../intelligence/llm-factory.js';
import { LLMCache } from '../intelligence/llm-cache.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { evaluateOutputs, evaluateOutputsWithLLM, type OutputEvaluation } from '../intelligence/output-evaluator.js';

// ── Public Types ──────────────────────────────────────────

export interface PipelineResult {
  understanding: any;
  routesDiscovered: number;
  elementsDiscovered: number;
  scenariosGenerated: number;
  testsGenerated: number;
  testsPassed: number;
  testsFailed: number;
  testsSkipped: number;
  qualityScore: number;
  gatePassed: boolean;
  outputEvaluations: OutputEvaluation[];
  /** Per-phase timing in ms */
  timing: Record<string, number>;
  /** Errors that occurred but didn't halt the pipeline */
  warnings: string[];
}

// ── Helpers ───────────────────────────────────────────────

/** Resolved path to the UIC CLI entry point (this package's own CLI) */
function uicBin(): string {
  // When running from the built package, `uic` should be on PATH.
  // Fall back to a direct node invocation of the dist CLI.
  const distCli = resolve(__dirname, '..', 'cli.js');
  if (existsSync(distCli)) {
    return `node ${distCli}`;
  }
  return 'npx uic';
}

/** Run a shell command, swallowing non-zero exits and returning success boolean */
function runStep(
  cmd: string,
  cwd: string,
  env?: Record<string, string>,
): { success: boolean; output: string } {
  const opts: ExecSyncOptions = {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
    timeout: 180_000,   // 3 min max per step
  };

  try {
    const out = execSync(cmd, opts);
    return { success: true, output: out?.toString() || '' };
  } catch (err: any) {
    const output = (err.stdout?.toString() || '') + '\n' + (err.stderr?.toString() || '');
    return { success: false, output };
  }
}

/** Count pass/fail/skip from Playwright JSON results */
function countResults(resultsPath: string): { total: number; passed: number; failed: number; skipped: number } {
  if (!existsSync(resultsPath)) return { total: 0, passed: 0, failed: 0, skipped: 0 };

  let data: any;
  try {
    data = JSON.parse(readFileSync(resultsPath, 'utf-8'));
  } catch {
    return { total: 0, passed: 0, failed: 0, skipped: 0 };
  }

  let total = 0, passed = 0, failed = 0, skipped = 0;

  function walk(suite: any) {
    for (const spec of suite.specs || []) {
      total++;
      if (spec.ok) {
        passed++;
      } else {
        // Check if all test results are 'skipped'
        const isSkipped = (spec.tests || []).every((t: any) =>
          (t.results || []).every((r: any) => r.status === 'skipped'),
        );
        if (isSkipped) {
          skipped++;
        } else {
          failed++;
        }
      }
    }
    for (const child of suite.suites || []) {
      walk(child);
    }
  }

  for (const suite of data.suites || []) {
    walk(suite);
  }
  return { total, passed, failed, skipped };
}

/** Count total elements across all routes in inventory */
function countElements(inventoryPath: string): number {
  if (!existsSync(inventoryPath)) return 0;
  try {
    const inv = JSON.parse(readFileSync(inventoryPath, 'utf-8'));
    return inv.summary?.totalElements || 0;
  } catch {
    return 0;
  }
}

/** Count generated test files in a directory */
function countTestFiles(testDir: string): number {
  if (!existsSync(testDir)) return 0;
  try {
    return readdirSync(testDir).filter((f: string) => f.endsWith('.spec.ts')).length;
  } catch {
    return 0;
  }
}

function elapsed(start: number): number {
  return Math.round(performance.now() - start);
}

// ── Main Pipeline ─────────────────────────────────────────

/**
 * Run the complete UIC pipeline in one shot.
 * This is what `npx uic` calls when no subcommand is given.
 */
export async function runFullPipeline(projectRoot: string): Promise<PipelineResult> {
  const cwd = resolve(projectRoot);
  const uicDir = join(cwd, '.uic');
  mkdirSync(uicDir, { recursive: true });

  // Detect if projectRoot is a frontend subdir (has package.json) while the
  // real project root (with pyproject.toml / README.md) is a parent directory.
  // readAppUnderstanding receives the original cwd — it has its own
  // resolveProjectRoot logic. Test operations still run from cwd (Playwright).
  const bin = uicBin();
  const timing: Record<string, number> = {};
  const warnings: string[] = [];

  // Load UIC config to get the app's base URL for service detection
  let configBaseUrl = 'http://localhost:3000';
  let config: any;
  try {
    config = await loadConfig(cwd);
    configBaseUrl = config.app?.baseUrl || configBaseUrl;
  } catch {
    // Config not loaded — use default
  }

  // Initialize LLM client (optional — falls back to heuristic)
  const llmClient = createLLMClient(config?.llm);
  const llmCache = new LLMCache(uicDir);
  if (llmClient) {
    console.log(`   LLM: ${llmClient.provider} (Claude-powered reasoning enabled)`);
  } else {
    console.log(`   No LLM API key found — using heuristic mode`);
    console.log(`      Set ANTHROPIC_API_KEY for Claude-powered test intelligence`);
  }

  const inventoryPath = join(uicDir, 'inventory.json');
  const contractPath = join(uicDir, 'contract.json');
  const ledgerPath = join(uicDir, 'ledger.json');
  const testResultsPath = join(uicDir, 'test-results.json');
  const testDir = join(cwd, 'tests', 'e2e');

  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║           UIC — Full Pipeline Run                   ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');

  // ── Phase 1: UNDERSTAND ────────────────────────────────
  console.log('📖 Phase 1: Reading codebase...');
  let t = performance.now();
  let understanding: any;
  try {
    // Pass cwd; readAppUnderstanding will resolve to the true project root
    understanding = await readAppUnderstanding(cwd);
    writeFileSync(join(uicDir, 'app-understanding.json'), JSON.stringify(understanding, null, 2));
    console.log(`   Project: "${understanding.projectName}"`);
    console.log(`   Goal: "${understanding.projectGoal}"`);
    console.log(`   Features: ${understanding.features.length} pages, ${understanding.aiFeatures.length} AI features`);
    const dataSummary = Object.entries(understanding.dataModel.recordCounts)
      .map(([k, v]) => `${v} ${k}`)
      .join(', ');
    if (dataSummary) {
      console.log(`   Data: ${dataSummary}`);
    }
  } catch (err: any) {
    understanding = { features: [], aiFeatures: [], dataModel: { entities: [], recordCounts: {}, sampleData: {} } };
    warnings.push(`Codebase reading failed: ${err.message}`);
    console.log(`   ⚠ Could not read codebase: ${err.message}`);
  }
  timing.understand = elapsed(t);
  console.log(`   (${timing.understand}ms)`);
  console.log('');

  // ── Phase 2: DISCOVER ──────────────────────────────────
  console.log('🔍 Phase 2: Discovering UI elements...');
  t = performance.now();

  // Check if the app's base URL is already responding — if so, skip service startup
  // to avoid the 10-minute timeout when services are already running
  let discoverEnv: Record<string, string> | undefined;
  const appBaseUrl = configBaseUrl;
  try {
    const controller = new AbortController();
    const checkTimeout = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch(appBaseUrl, { signal: controller.signal, redirect: 'follow' });
    clearTimeout(checkTimeout);
    if (resp.status >= 200 && resp.status < 500) {
      console.log(`   App already responding at ${appBaseUrl} — skipping service startup`);
      discoverEnv = { UIC_SKIP_SERVICES: '1' };
    }
  } catch {
    // App not responding, let discover handle service startup normally
  }

  const discoverResult = runStep(`${bin} discover`, cwd, discoverEnv);
  timing.discover = elapsed(t);
  if (!discoverResult.success) {
    warnings.push('Discovery had errors (may still have partial results)');
    console.log('   ⚠ Discovery encountered errors');
  }
  const elementsFound = countElements(inventoryPath);
  if (existsSync(inventoryPath)) {
    const inv = JSON.parse(readFileSync(inventoryPath, 'utf-8'));
    console.log(`   Routes: ${inv.summary?.totalRoutes || 0}`);
    console.log(`   Elements: ${elementsFound}`);
  } else {
    console.log('   ⚠ No inventory produced');
  }
  console.log(`   (${timing.discover}ms)`);
  console.log('');

  // ── Phase 3: CONTRACT + LEDGER ─────────────────────────
  console.log('📋 Phase 3: Generating contract and affordance ledger...');
  t = performance.now();
  const contractResult = runStep(`${bin} contract gen`, cwd);
  timing.contract = elapsed(t);
  if (!contractResult.success) {
    warnings.push('Contract generation failed');
    console.log('   ⚠ Contract generation failed');
  } else {
    if (existsSync(contractPath)) {
      const contract = JSON.parse(readFileSync(contractPath, 'utf-8'));
      console.log(`   Surfaces: ${contract.surfaces?.length || 0}`);
      console.log(`   Flows: ${contract.flows?.length || 0}`);
    }
    if (existsSync(ledgerPath)) {
      const ledger = JSON.parse(readFileSync(ledgerPath, 'utf-8'));
      console.log(`   Affordances: ${ledger.deduplicatedTo || 0} (${ledger.dispositions?.executable || 0} executable)`);
    }
  }
  console.log(`   (${timing.contract}ms)`);
  console.log('');

  // ── Phase 3.5: INTELLIGENT SCENARIOS ────────────────────
  console.log('🧠 Phase 3.5: Generating intelligent test scenarios...');
  t = performance.now();
  let scenariosGenerated = 0;
  try {
    if (existsSync(inventoryPath)) {
      const inventory = JSON.parse(readFileSync(inventoryPath, 'utf-8'));
      const scenarios = llmClient
        ? await generateTestScenariosWithLLM(understanding, inventory, llmClient, llmCache)
        : generateTestScenarios(understanding, inventory);
      scenariosGenerated = scenarios.reduce((sum, ts) => sum + ts.scenarios.length, 0);

      // Save scenarios
      writeFileSync(join(uicDir, 'test-scenarios.json'), JSON.stringify(scenarios, null, 2));

      // Generate intelligent test files
      const { files: intelligentFiles, result: igResult } = generateIntelligentTests(scenarios);
      mkdirSync(testDir, { recursive: true });

      let written = 0;
      for (const [fileName, content] of intelligentFiles) {
        const filePath = join(testDir, `intelligent-${fileName.replace('.intelligent.spec.ts', '')}.spec.ts`);
        if (!existsSync(filePath)) {
          writeFileSync(filePath, content);
          written++;
        }
      }
      console.log(`   Scenarios: ${scenariosGenerated} across ${scenarios.length} features`);
      console.log(`   Intelligent tests: ${igResult.totalFiles} files (${written} new, ${igResult.totalFiles - written} existing)`);
      console.log(`   Priority: ${igResult.criticalTests} critical, ${igResult.highTests} high, ${igResult.mediumTests} medium, ${igResult.lowTests} low`);
    } else {
      console.log('   ⚠ No inventory available — skipping intelligent scenarios');
      warnings.push('Intelligent scenario generation skipped (no inventory)');
    }
  } catch (err: any) {
    warnings.push(`Intelligent scenario generation failed: ${err.message}`);
    console.log(`   ⚠ Failed: ${err.message}`);
  }
  timing.intelligentScenarios = elapsed(t);
  console.log(`   (${timing.intelligentScenarios}ms)`);
  console.log('');

  // ── Phase 4: GENERATE TESTS ────────────────────────────
  console.log('🧪 Phase 4: Generating tests...');
  t = performance.now();
  const existingTestCount = countTestFiles(testDir);
  if (existingTestCount > 0) {
    console.log(`   Found ${existingTestCount} existing test files — preserving existing, generating missing`);
    // Run test gen with default --no-overwrite to generate any MISSING test files
    // without touching existing ones
    const testGenResult = runStep(`${bin} test gen`, cwd);
    if (!testGenResult.success) {
      warnings.push('Test generation (no-overwrite) had errors');
      console.log('   ⚠ Test generation encountered errors');
    }
  } else {
    const testGenResult = runStep(`${bin} test gen`, cwd);
    if (!testGenResult.success) {
      warnings.push('Test generation had errors');
      console.log('   ⚠ Test generation encountered errors');
    }
  }
  timing.generate = elapsed(t);
  const testsGenerated = countTestFiles(testDir);
  console.log(`   Test files: ${testsGenerated}`);

  // Also generate journey tests if configured (only if journeys.spec.ts doesn't exist)
  const journeyFile = join(testDir, 'journeys.spec.ts');
  if (!existsSync(journeyFile)) {
    const journeyResult = runStep(`${bin} journey gen`, cwd);
    if (journeyResult.success) {
      const journeyCount = countTestFiles(testDir) - testsGenerated;
      if (journeyCount > 0) {
        console.log(`   Journey tests: ${journeyCount}`);
      }
    }
  } else {
    console.log(`   ⏭ Skipping journey gen (journeys.spec.ts exists)`);
  }
  console.log(`   (${timing.generate}ms)`);
  console.log('');

  // ── Phase 5: EXECUTE TESTS ─────────────────────────────
  console.log('▶️  Phase 5: Running tests...');
  t = performance.now();
  const testRunResult = runStep(`${bin} test run`, cwd);

  // If test-results.json is empty or missing, generate it directly
  if (!existsSync(testResultsPath) || readFileSync(testResultsPath, 'utf-8').trim().length < 100) {
    runStep('npx playwright test --reporter=json 2>/dev/null > .uic/test-results.json', cwd);
  }

  timing.execute = elapsed(t);

  const counts = countResults(testResultsPath);
  if (counts.total > 0) {
    const passIcon = counts.failed === 0 ? '✅' : '❌';
    console.log(`   ${passIcon} ${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped (${counts.total} total)`);
  } else {
    warnings.push('No test results captured');
    console.log('   ⚠ No test results captured');
  }
  console.log(`   (${timing.execute}ms)`);
  console.log('');

  // ── Phase 6: EVALUATE OUTPUT QUALITY ───────────────────
  console.log('📊 Phase 6: Evaluating output quality...');
  t = performance.now();
  let evaluations = llmClient
    ? await evaluateOutputsWithLLM(understanding, testResultsPath, llmClient)
    : evaluateOutputs(understanding, testResultsPath);
  timing.evaluate = elapsed(t);

  if (evaluations.length > 0) {
    const avgScore = evaluations.reduce((s, e) => s + e.qualityScore, 0) / evaluations.length;
    console.log(`   AI feature tests evaluated: ${evaluations.length}`);
    console.log(`   Average quality score: ${avgScore.toFixed(1)}/10`);
    for (const ev of evaluations) {
      const icon = ev.qualityScore >= 7 ? '✅' : ev.qualityScore >= 4 ? '🟡' : '🔴';
      console.log(`   ${icon} ${ev.testName}: ${ev.qualityScore}/10 — ${ev.reasoning.substring(0, 80)}`);
    }
  } else {
    console.log('   No AI feature outputs to evaluate');
  }

  // Write evaluation results
  if (evaluations.length > 0) {
    writeFileSync(
      join(uicDir, 'output-evaluations.json'),
      JSON.stringify(evaluations, null, 2),
    );
  }
  console.log(`   (${timing.evaluate}ms)`);
  console.log('');

  // ── Phase 6.5: QUALITY IMPROVEMENT LOOP ────────────────
  // Use evidence report quality score (based on test code analysis), not output evaluator
  let currentAvgScore = 0;
  const evidenceResult = runStep(`${bin} evidence`, cwd);
  const evidencePath = join(uicDir, 'evidence-report.json');
  if (existsSync(evidencePath)) {
    try {
      const evidence = JSON.parse(readFileSync(evidencePath, 'utf-8'));
      currentAvgScore = evidence.summary?.averageQuality ?? 0;
    } catch { /* ignore parse errors */ }
  }
  console.log(`   Evidence quality score: ${currentAvgScore.toFixed(1)}/10`);

  if (currentAvgScore < 9.5) {
    console.log('🔄 Phase 6.5: Quality improvement loop...');
    t = performance.now();
    const maxIterations = 3;

    // First: strengthen tests with quality signals
    const { strengthenTests } = await import('../repair/strengthener.js');
    const strengthenResult = strengthenTests(testDir);
    if (strengthenResult.signalsAdded > 0) {
      console.log(`   Added ${strengthenResult.signalsAdded} quality signals to ${strengthenResult.testsStrengthened} tests`);
    }

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      const previousScore = currentAvgScore;

      // Run optimize
      console.log(`   Iteration ${iteration}: optimizing tests...`);
      runStep(`${bin} optimize --iterations 3`, cwd);

      // Re-run tests
      console.log(`   Iteration ${iteration}: re-running tests...`);
      runStep(`${bin} test run`, cwd);

      // Fallback for test results
      if (!existsSync(testResultsPath) || readFileSync(testResultsPath, 'utf-8').trim().length < 100) {
        runStep('npx playwright test --reporter=json 2>/dev/null > .uic/test-results.json', cwd);
      }

      // Re-evaluate using evidence reporter (test code analysis)
      runStep(`${bin} evidence`, cwd);
      if (existsSync(evidencePath)) {
        try {
          const evidence = JSON.parse(readFileSync(evidencePath, 'utf-8'));
          currentAvgScore = evidence.summary?.averageQuality ?? currentAvgScore;
        } catch { /* ignore parse errors */ }
      }

      console.log(`   Quality loop iteration ${iteration}: ${previousScore.toFixed(1)} → ${currentAvgScore.toFixed(1)}`);

      if (currentAvgScore >= 9.5) {
        console.log(`   ✅ Quality target reached: ${currentAvgScore.toFixed(1)}/10`);
        break;
      }

      if (iteration === maxIterations) {
        console.log(`   ⚠ Max iterations reached. Final quality: ${currentAvgScore.toFixed(1)}/10`);
        warnings.push(`Quality improvement loop exhausted (${maxIterations} iterations). Score: ${currentAvgScore.toFixed(1)}/10`);
      }
    }

    // Update test counts after improvement loop
    const updatedCounts = countResults(testResultsPath);
    Object.assign(counts, updatedCounts);

    timing.qualityLoop = elapsed(t);
    console.log(`   (${timing.qualityLoop}ms)`);
    console.log('');
  }

  // ── Phase 7: GATE ──────────────────────────────────────
  console.log('🚦 Phase 7: Checking coverage gate...');
  t = performance.now();
  const gateResult = runStep(`${bin} gate`, cwd);
  timing.gate = elapsed(t);
  const gatePassed = gateResult.success;
  console.log(`   ${gatePassed ? '✅ GATE PASSED' : '❌ GATE FAILED'}`);
  console.log(`   (${timing.gate}ms)`);
  console.log('');

  // ── Summary ────────────────────────────────────────────
  const avgQuality = currentAvgScore;

  const totalTime = Object.values(timing).reduce((s, t) => s + t, 0);

  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║                    SUMMARY                          ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  Routes discovered:    ${String(understanding.features.length).padStart(6)}                       ║`);
  console.log(`║  Elements discovered:  ${String(elementsFound).padStart(6)}                       ║`);
  console.log(`║  Tests generated:      ${String(testsGenerated).padStart(6)}                       ║`);
  console.log(`║  Tests passed:         ${String(counts.passed).padStart(6)}                       ║`);
  console.log(`║  Tests failed:         ${String(counts.failed).padStart(6)}                       ║`);
  console.log(`║  Tests skipped:        ${String(counts.skipped).padStart(6)}                       ║`);
  console.log(`║  Quality score:        ${avgQuality.toFixed(1).padStart(6)}/10                    ║`);
  console.log(`║  Gate:              ${(gatePassed ? 'PASSED' : 'FAILED').padStart(9)}                       ║`);
  console.log(`║  Total time:        ${(totalTime / 1000).toFixed(1).padStart(7)}s                      ║`);
  console.log('╚══════════════════════════════════════════════════════╝');

  if (warnings.length > 0) {
    console.log('');
    console.log('Warnings:');
    for (const w of warnings) {
      console.log(`  ⚠ ${w}`);
    }
  }
  console.log('');

  const result: PipelineResult = {
    understanding,
    routesDiscovered: understanding.features.length,
    elementsDiscovered: elementsFound,
    scenariosGenerated,
    testsGenerated,
    testsPassed: counts.passed,
    testsFailed: counts.failed,
    testsSkipped: counts.skipped,
    qualityScore: Math.round(avgQuality * 10) / 10,
    gatePassed,
    outputEvaluations: evaluations,
    timing,
    warnings,
  };

  // Write full pipeline result
  writeFileSync(
    join(uicDir, 'pipeline-result.json'),
    JSON.stringify(result, null, 2),
  );

  return result;
}
