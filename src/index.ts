/**
 * UIC — Browser-First UI Coverage Enforcement
 *
 * Public API for programmatic usage.
 */

export { loadConfig, getArtifactPaths } from './config/loader.js';
export { detectStack } from './config/detector.js';
export { discover } from './discovery/crawler.js';
export { classifyElement } from './discovery/element-classifier.js';
export { generateContract, writeContract } from './contract/generator.js';
export { diffContracts, applyDiff } from './contract/differ.js';
export { checkCoverage, printReport, writeReport } from './gate/checker.js';
export { authenticatePersona } from './auth/persona.js';
export { generateTests } from './runner/test-generator.js';
export { classifyAffordances } from './affordance/classifier.js';
export { buildLedger, writeLedger } from './affordance/ledger.js';
export { generateInteractionTests } from './generation/primitive-generator.js';
export { getWidgetAdapter } from './generation/adapters.js';
export { ensureServerRunning, stopServer } from './utils/server.js';
export { diagnoseFailure, diagnoseAllFailures } from './repair/diagnoser.js';
export { synthesizePreconditions } from './repair/precondition-synthesizer.js';
export { checkHardGate, buildMetrics, writeQualityReport, writeRepairLog } from './repair/quality-tracker.js';

export type * from './config/types.js';
