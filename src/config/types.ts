/**
 * UIC Configuration Types
 *
 * These types define the project-specific configuration that consumers
 * provide in their uic.config.ts file. The tool reads this config to
 * adapt its behavior to the target application.
 */

export interface UicConfig {
  app: AppConfig;
  /** Multiple services to start in dependency order (replaces app.startCommand) */
  services?: ServiceConfig[];
  /** Pre-flight environment checks — run before service startup */
  preflight?: PreflightConfig;
  /** Data seeding — run after auth, before discovery */
  seeding?: SeedConfig;
  auth?: AuthConfig;
  discovery: DiscoveryConfig;
  contract?: ContractConfig;
  /** User journey definitions for multi-step flow tests */
  journeys?: JourneyConfig[];
  /** Observation configuration for semantic interaction layer */
  observe?: ObserveConfig;
  /** LLM configuration for Claude-powered app understanding */
  llm?: {
    provider: 'anthropic' | 'openai';
    apiKey?: string;
    model?: string;
    baseUrl?: string;
  };
  exclusions?: Exclusion[];
}

export interface AppConfig {
  /** Display name of the application */
  name: string;
  /** Detected or declared framework: react, vue, svelte, angular, nextjs, etc. */
  framework?: string;
  /** Base URL of the running application */
  baseUrl: string;
  /** Command to start the dev server */
  startCommand?: string;
  /** Timeout in ms for dev server startup */
  startTimeout?: number;
}

// ── Multi-Service Types ────────────────────────────────────

export interface ServiceConfig {
  /** Display name for logging */
  name: string;
  /** Shell command to start the service */
  command: string;
  /** Port the service listens on */
  port: number;
  /** Health check path — appended to http://localhost:{port} */
  healthCheck: string;
  /** Working directory relative to project root */
  cwd?: string;
  /** Extra environment variables for this service */
  env?: Record<string, string>;
  /** Max startup time in ms (default: 30000) */
  startTimeout?: number;
  /** Names of services that must be healthy before this one starts */
  dependsOn?: string[];
  /** Command to run if the main command fails (e.g., install deps) */
  installCommand?: string;
}

// ── Pre-flight Types ───────────────────────────────────────

export interface PreflightConfig {
  checks: PreflightCheck[];
}

export interface PreflightCheck {
  /** Human-readable name */
  name: string;
  /** Shell command — exit 0 means pass */
  test: string;
  /** Shell command to auto-fix if test fails */
  fix?: string;
  /** Fail the pipeline if both test and fix fail (default: true) */
  required?: boolean;
}

// ── Seeding Types ──────────────────────────────────────────

export interface SeedConfig {
  /** API calls to seed data (executed in order) */
  apiCalls?: SeedApiCall[];
  /** Directory containing fixture files to upload */
  fixtureDir?: string;
  /** Upload endpoint for fixture files (required if fixtureDir is set) */
  fixtureUploadEndpoint?: string;
  /** Form field name for file uploads (default: 'file') */
  fixtureFieldName?: string;
  /** Shell script to run for seeding */
  script?: string;
}

export interface SeedApiCall {
  method: 'POST' | 'PUT' | 'PATCH';
  /** API path (appended to app.baseUrl) */
  endpoint: string;
  /** Request body */
  body: Record<string, unknown>;
  /** Whether this call needs the authenticated session cookie */
  authenticated: boolean;
  /** Human-readable description */
  description?: string;
}

// ── Journey Types ──────────────────────────────────────────

export interface JourneyConfig {
  /** Unique journey ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** Which persona executes this journey */
  persona: string;
  /** Whether this journey is required to pass the gate */
  required: boolean;
  /** Ordered steps */
  steps: JourneyStep[];
}

export interface JourneyStep {
  action: 'goto' | 'click' | 'fill' | 'upload' | 'wait'
    | 'assert-visible' | 'assert-hidden' | 'assert-url' | 'assert-text';
  /** Human-readable description of what this step does */
  description?: string;
  /** Selector, role-based locator string, or URL */
  target?: string;
  /** Value for fill/assert-text/assert-url */
  value?: string;
  /** Step timeout in ms */
  timeout?: number;
}

// ── Auth Types ─────────────────────────────────────────────

export interface AuthConfig {
  /** Authentication strategy */
  strategy: 'storage-state' | 'ui-flow' | 'api-bootstrap' | 'custom';
  /** Named personas with their credentials/config */
  personas?: Record<string, PersonaConfig>;
  /** Path to custom auth hook module (for 'custom' strategy) */
  customHook?: string;
  /** URL patterns that indicate a login/auth page (default: ['/login', '/signin', '/auth']) */
  loginPatterns?: string[];
  /** API endpoints whose errors should be ignored during testing (e.g., auth probes) */
  ignoredEndpoints?: string[];
  /** Auth header format: 'cookie' (default) or 'bearer' */
  headerFormat?: 'cookie' | 'bearer';
  /** Submit button patterns for UI-flow login (default: /sign in|log in|submit|continue/i) */
  submitButtonPattern?: string;
}

export interface PersonaConfig {
  /** Login email/username — supports ${ENV_VAR} interpolation */
  email?: string;
  /** Login password — supports ${ENV_VAR} interpolation */
  password?: string;
  /** API endpoint for api-bootstrap strategy */
  loginEndpoint?: string;
  /** Path to saved storage state file (for storage-state strategy) */
  storageStatePath?: string;
  /** UI login flow steps (for ui-flow strategy) */
  loginSteps?: LoginStep[];
  /** Additional data to send with API login */
  loginData?: Record<string, string>;
  /** Signup endpoint for api-bootstrap fallback (omit to disable auto-signup) */
  signupEndpoint?: string;
  /** Custom signup request body (default: uses email + password from persona) */
  signupBody?: Record<string, unknown>;
}

export interface LoginStep {
  action: 'goto' | 'fill' | 'click' | 'wait';
  selector?: string;
  value?: string;
  url?: string;
  timeout?: number;
}

export interface DiscoveryConfig {
  /** Routes to start crawling from */
  seedRoutes: string[];
  /** Routes to skip during discovery */
  excludeRoutes?: string[];
  /** Max navigation depth from seed routes */
  maxDepth?: number;
  /** Wait time (ms) after each navigation for dynamic content */
  waitAfterNavigation?: number;
  /** Viewport width for discovery */
  viewportWidth?: number;
  /** Viewport height for discovery */
  viewportHeight?: number;
  /** Whether to take screenshots during discovery */
  screenshots?: boolean;
  /** Routes that are public (no auth required). Default: login/signup/forgot/reset patterns */
  publicRoutes?: string[];
  /** Page load wait strategy (default: 'domcontentloaded'). Use 'networkidle' only for static sites */
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
  /** Landmark element to verify authenticated pages loaded (default: none — skip check) */
  authLandmark?: string;
}

export interface ContractConfig {
  /** Path to the contract file (default: .uic/contract.json) */
  path?: string;
  /** Path to the inventory file (default: .uic/inventory.json) */
  inventoryPath?: string;
  /** Path to the report file (default: .uic/report.json) */
  reportPath?: string;
  /** Path to test results (default: .uic/test-results.json) */
  testResultsPath?: string;
}

export interface Exclusion {
  /** Route pattern or feature name to exclude */
  pattern: string;
  /** Why this is excluded */
  reason: string;
}

// ── Inventory Types ─────────────────────────────────────────

export interface UIInventory {
  appName: string;
  baseUrl: string;
  discoveredAt: string;
  discoveryMethod: 'browser-crawl';
  config: {
    framework?: string;
    authStrategy?: string;
  };
  routes: DiscoveredRoute[];
  summary: InventorySummary;
}

export interface DiscoveredRoute {
  path: string;
  url: string;
  title: string;
  requiresAuth: boolean;
  screenshot?: string;
  elements: DiscoveredElement[];
  consoleErrors: string[];
  failedRequests: FailedRequest[];
  confidence: 'high' | 'medium' | 'low';
  discoveredAt: string;
  notes: string[];
  /** Element groupings discovered during crawl */
  interactionGroups?: ElementGrouping[];
}

export interface DiscoveredElement {
  tag: string;
  type?: string;
  role?: string;
  label?: string;
  text?: string;
  name?: string;
  placeholder?: string;
  href?: string;
  disabled: boolean;
  visible: boolean;
  testId?: string;
  selector: string;
  classification: ElementClassification;
}

export type ElementClassification =
  | 'button'
  | 'link'
  | 'text-input'
  | 'password-input'
  | 'email-input'
  | 'search-input'
  | 'file-upload'
  | 'checkbox'
  | 'date-input'
  | 'textarea'
  | 'select'
  | 'table'
  | 'form'
  | 'tab'
  | 'dialog'
  | 'toggle'
  | 'menu'
  | 'other';

export interface FailedRequest {
  url: string;
  status: number;
  method: string;
}

export interface InventorySummary {
  totalRoutes: number;
  totalElements: number;
  totalButtons: number;
  totalInputs: number;
  totalLinks: number;
  totalTables: number;
  totalDialogs: number;
  authRequired: number;
  authNotRequired: number;
  consoleErrorCount: number;
  failedRequestCount: number;
}

// ── Contract Types ──────────────────────────────────────────

export interface UIContract {
  version: '1.0';
  generatedAt: string;
  app: {
    name: string;
    baseUrl: string;
    framework?: string;
  };
  surfaces: Surface[];
  flows: Flow[];
  invariants: Invariant[];
  exclusions: Exclusion[];
}

export interface Surface {
  id: string;
  route: string;
  persona: string;
  viewport: 'desktop' | 'mobile';
  state: 'initial' | 'empty' | 'loaded' | 'error';
  checkpoint: string;
  expectations: {
    required_elements: RequiredElement[];
    forbidden_elements: string[];
    no_console_errors: boolean;
    no_failed_requests: boolean;
    navigation_works: boolean;
    visual_snapshot: boolean;
  };
  policy: {
    required: boolean;
    severity: 'blocking' | 'warning' | 'info';
    owner?: string;
    rationale?: string;
  };
  metadata: {
    discovered_at: string;
    last_seen: string;
    source: 'auto-discovery' | 'manual' | 'template';
    status: 'active' | 'removed' | 'unreachable' | 'changed';
  };
}

export interface RequiredElement {
  role?: string;
  name?: string;
  selector?: string;
  required: boolean;
  note?: string;
}

export interface Flow {
  id: string;
  name: string;
  steps: string[];
  required: boolean;
  persona: string;
  status?: 'active' | 'removed' | 'unreachable';
}

export interface Invariant {
  name: string;
  required: boolean;
  description?: string;
}

// ── Report Types ────────────────────────────────────────────

export interface CoverageReport {
  timestamp: string;
  passed: boolean;
  strict: boolean;
  summary: {
    errors: number;
    warnings: number;
    surfaces_total: number;
    surfaces_tested: number;
    surfaces_required: number;
    flows_total: number;
    flows_tested: number;
    flows_required: number;
    invariants_total: number;
    invariants_tested: number;
  };
  issues: CoverageIssue[];
}

export interface CoverageIssue {
  type: 'missing_test' | 'missing_flow_test' | 'missing_invariant' | 'drift_new' | 'drift_removed' | 'drift_changed' | 'shallow_only' | 'todo_stub' | 'unaccounted';
  severity: 'error' | 'warning' | 'info';
  item: string;
  message: string;
}

// ── Affordance Types (v2) ──────────────────────────────────

export type AffordanceElementType =
  | 'button' | 'input' | 'link' | 'checkbox' | 'select'
  | 'file-input' | 'textarea' | 'table' | 'dialog' | 'form';

export type ActionType = 'click' | 'fill' | 'toggle' | 'select-option' | 'upload' | 'navigate';

export type OracleType =
  | 'url-changes'
  | 'element-appears'
  | 'element-disappears'
  | 'attribute-changes'
  | 'count-changes'
  | 'network-fires'
  | 'content-changes'
  | 'no-crash';      // conservative fallback: click + assert no errors

export type AffordanceDisposition = 'executable' | 'grouped' | 'blocked' | 'informational' | 'excluded';

export interface FixtureRequirement {
  type: 'auth' | 'data-seed' | 'file' | 'api-key' | 'admin-role';
  description: string;
  available: boolean;
}

export interface Affordance {
  id: string;
  route: string;
  elementType: AffordanceElementType;
  action: ActionType;
  oracle: OracleType;
  severity: 'blocking' | 'warning' | 'info';
  disposition: AffordanceDisposition;
  target: {
    role?: string;
    name?: string;
    selector: string;
    placeholder?: string;
  };
  label: string;
  confidence: 'high' | 'medium' | 'low';
  fixture?: FixtureRequirement;
  mutatesState: boolean;
  blockReason?: string;
  groupedInto?: string;
  excludedBy?: string;
  generatedTest: boolean;
  persona: string;
  repairHints?: string[];
}

export interface AffordanceLedger {
  generatedAt: string;
  discoveredRaw: number;
  deduplicatedTo: number;
  accountedFor: number;
  unaccounted: number;
  dispositions: {
    executable: number;
    grouped: number;
    blocked: number;
    informational: number;
    excluded: number;
  };
  byRoute: Array<{
    route: string;
    raw: number;
    deduplicated: number;
    executable: number;
    blocked: number;
    grouped: number;
    informational: number;
    excluded: number;
  }>;
  affordances: Affordance[];
}

// ── Semantic Interaction Layer Types (v4) ────────────────

/** Recognized page-level interaction patterns */
export type InteractionPattern =
  | 'chat'             // input → submit → response appended
  | 'search'           // query → submit → results list replaces
  | 'form-submit'      // fill fields → submit → confirmation/redirect
  | 'list-filter'      // filter controls → list updates in place
  | 'wizard'           // step form → next → new step form
  | 'auth-flow'        // credentials → submit → redirect
  | 'crud-create'      // fill → submit → item appears in list
  | 'toggle-panel'     // button → content panel shows/hides
  | 'modal-dialog'     // trigger → modal opens → interact → close
  | 'pagination'       // nav controls → content replaces
  | 'unknown';         // grouped but pattern not recognized

/** A region of the page where output appears after an interaction */
export interface OutputZone {
  /** CSS selector for the zone */
  selector: string;
  /** What kind of content appears here */
  type: 'append' | 'replace' | 'count-change' | 'text-change' | 'visibility-toggle';
  /** Selector for individual items within the zone (for lists, tables) */
  itemSelector?: string;
  /** How this zone was identified */
  source: 'dom-proximity' | 'aria-relationship' | 'observation' | 'heuristic';
}

/** Lightweight grouping data from the discovery phase */
export interface ElementGrouping {
  /** Unique group ID */
  id: string;
  /** Container CSS selector */
  containerSelector: string;
  /** Selectors of member elements */
  memberSelectors: string[];
  /** Bounding box of the container */
  boundingBox: { x: number; y: number; width: number; height: number };
  /** ARIA relationships discovered */
  ariaRelationships: Array<{ from: string; to: string; type: string }>;
}

/** A group of related elements that form a functional unit */
export interface InteractionGroup {
  id: string;
  route: string;
  pattern: InteractionPattern;
  confidence: 'high' | 'medium' | 'low';
  /** The elements that comprise this group, by role in the pattern */
  members: {
    inputs: string[];     // affordance IDs
    triggers: string[];   // affordance IDs
    outputs: OutputZone[];
  };
  /** Container selector that encloses all members */
  containerSelector?: string;
  /** Observed behavior from probing (filled after observation phase) */
  observation?: InteractionObservation;
}

/** Result of probing the live DOM after performing an interaction */
export interface InteractionObservation {
  /** What DOM mutations were observed */
  mutations: ObservedMutation[];
  /** Network requests fired */
  networkRequests: ObservedRequest[];
  /** How long until changes stabilized (ms) */
  settleTime: number;
  /** Whether the URL changed */
  urlChanged: boolean;
  newUrl?: string;
  /** Snapshot of output zone content before and after */
  outputDelta?: {
    before: string;
    after: string;
    itemCountBefore: number;
    itemCountAfter: number;
  };
  /** Screenshot paths */
  screenshotBefore?: string;
  screenshotAfter?: string;
  /** Prerequisite discovered and executed before main interaction */
  prerequisite?: PrerequisiteResult;
  /** Quality score for this observation */
  qualityScore?: InteractionQualityScore;
}

/** Result of trying a prerequisite activation before the main interaction */
export interface PrerequisiteResult {
  /** What action was taken */
  action: 'click';
  /** CSS selector of the activation element */
  selector: string;
  /** Visible text/label of the activation element */
  label: string;
  /** What changed after clicking */
  effect: string;
  /** Whether the original interaction succeeded after this prerequisite */
  succeeded: boolean;
  /** The observation from the retried interaction (if succeeded) */
  observation?: InteractionObservation;
}

/** Interaction quality score with breakdown */
export interface InteractionQualityScore {
  /** Overall score 0-10 */
  score: number;
  /** Human-readable band */
  band: 'blocked' | 'no-effect' | 'superficial' | 'client-only' | 'real' | 'verified';
  /** Individual signal scores */
  signals: {
    attempted: boolean;
    mutationCount: number;
    networkRequestCount: number;
    outputChanged: boolean;
    outputLengthDelta: number;
    itemCountDelta: number;
    hasErrorIndicator: boolean;
    urlChanged: boolean;
  };
}

/** Per-test evidence for the comprehensive report */
export interface TestEvidence {
  testId: string;
  testName: string;
  route: string;
  pattern?: InteractionPattern;
  input?: string;
  action: string;
  prerequisitesUsed?: PrerequisiteResult[];
  observation?: {
    mutationCount: number;
    networkRequests: string[];
    settleTime: number;
    outputBefore?: string;
    outputAfter?: string;
  };
  qualityScore: InteractionQualityScore;
  claudeJudgment?: {
    verdict: 'pass' | 'weak' | 'fail';
    reasoning: string;
  };
  result: 'pass' | 'fail' | 'skip';
  resultReason?: string;
}

export interface ObservedMutation {
  type: 'childList' | 'attributes' | 'characterData';
  targetSelector: string;
  addedCount: number;
  removedCount: number;
  attributeName?: string;
}

export interface ObservedRequest {
  url: string;
  method: string;
  status: number;
  contentType?: string;
}

/** Validation result from output judging */
export interface ValidationResult {
  passed: boolean;
  confidence: 'high' | 'medium' | 'low';
  method: 'heuristic' | 'screenshot-llm' | 'text-llm';
  issues: string[];
  screenshot?: string;
}

/** A composite test that exercises an interaction group end-to-end */
export interface CompositeTest {
  id: string;
  groupId: string;
  route: string;
  pattern: InteractionPattern;
  name: string;
  steps: CompositeTestStep[];
  observationBased: boolean;
}

export interface CompositeTestStep {
  action: 'goto' | 'fill' | 'click' | 'press-key' | 'wait-for-selector'
    | 'wait-for-response' | 'wait-for-mutation' | 'assert-visible'
    | 'assert-text-changed' | 'assert-count-changed' | 'assert-url'
    | 'assert-element-appeared' | 'assert-no-error';
  target?: string;
  value?: string;
  timeout?: number;
  description: string;
}

/** Extended ledger that includes interaction groups */
export interface SemanticLedger extends AffordanceLedger {
  interactionGroups: InteractionGroup[];
  compositeTests: CompositeTest[];
  semanticSummary: {
    totalGroups: number;
    patterns: Partial<Record<InteractionPattern, number>>;
    observedGroups: number;
    compositeTestsGenerated: number;
  };
}

/** Observation configuration */
export interface ObserveConfig {
  /** Enable observation during discovery (default: false) */
  enabled: boolean;
  /** Max interaction groups to observe per run (default: 50) */
  budget?: number;
  /** Times to repeat each observation for stability (default: 2) */
  repetitions?: number;
  /** Skip mutating elements during observation (default: true) */
  blockMutating?: boolean;
  /** Enable LLM-based output validation via screenshots (default: false) */
  llmValidation?: boolean;
  /** Custom error text patterns to detect */
  errorPatterns?: string[];
  /** Take before/after screenshots during observation (default: true) */
  screenshots?: boolean;
  /** Enable prerequisite exploration for no-effect interactions (default: true) */
  prerequisiteExploration?: boolean;
  /** Max prerequisite attempts per group (default: 5) */
  maxPrerequisiteAttempts?: number;
}
