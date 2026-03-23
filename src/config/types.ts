/**
 * UIC Configuration Types
 *
 * These types define the project-specific configuration that consumers
 * provide in their uic.config.ts file. The tool reads this config to
 * adapt its behavior to the target application.
 */

export interface UicConfig {
  app: AppConfig;
  auth?: AuthConfig;
  discovery: DiscoveryConfig;
  contract?: ContractConfig;
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

export interface AuthConfig {
  /** Authentication strategy */
  strategy: 'storage-state' | 'ui-flow' | 'api-bootstrap' | 'custom';
  /** Named personas with their credentials/config */
  personas?: Record<string, PersonaConfig>;
  /** Path to custom auth hook module (for 'custom' strategy) */
  customHook?: string;
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
