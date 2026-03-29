/**
 * UIC Intelligence Layer Types
 *
 * These types represent the AI QA engineer's understanding of a target
 * application — derived from reading the codebase, not from LLM inference.
 * The app-reader module populates these structures through static analysis.
 */

// ── App Understanding ──────────────────────────────────────

/** Understanding of the entire application derived from reading the codebase */
export interface AppUnderstanding {
  projectName: string;
  projectGoal: string;           // e.g., "AI executive assistant for email management"
  projectDescription: string;    // longer description from README
  techStack: TechStack;
  features: FeatureMap[];
  dataModel: DataModel;
  apiEndpoints: ApiEndpoint[];
  aiFeatures: AiFeature[];
  seedDataDescription: string;   // what test data is available
}

export interface TechStack {
  frontend: string;              // "React 19 + Vite"
  backend: string;               // "FastAPI + SQLAlchemy"
  database: string;              // "SQLite"
  ai: string[];                  // ["Claude API", "OpenAI embeddings"]
}

// ── Feature Map ────────────────────────────────────────────

export interface FeatureMap {
  route: string;                 // "/chat"
  pageName: string;              // "Chat"
  purpose: string;               // "AI-powered Q&A over user's email corpus"
  isAiFeature: boolean;          // true if this page uses LLM/AI
  keyElements: string[];         // ["chat input", "Quick mode", "Deep Think mode", "conversation sidebar"]
  expectedBehavior: string;      // "Takes natural language queries, returns AI answers with citations"
  relatedApiEndpoints: string[]; // ["/api/v1/chat/sessions", "/api/v1/chat/sessions/:id/query"]
  testPriority: 'critical' | 'high' | 'medium' | 'low';
}

// ── Data Model ─────────────────────────────────────────────

export interface DataModel {
  entities: EntityInfo[];
  recordCounts: Record<string, number>;  // { "emails": 90, "tasks": 5 }
  sampleData: Record<string, any[]>;     // { "emails": [{ subject: "Q4 budget..." }] }
}

export interface EntityInfo {
  name: string;                  // "Email"
  tableName: string;             // "emails"
  keyFields: string[];           // ["subject", "from_name", "date"]
  description: string;           // "Ingested email messages with full text and metadata"
}

// ── API Endpoints ──────────────────────────────────────────

export interface ApiEndpoint {
  method: string;                // "GET" | "POST" | etc.
  path: string;                  // "/api/v1/search/recent"
  purpose: string;               // "Return recent emails with pagination"
  requiresAuth: boolean;
  relatedFeature: string;        // "/search"
}

// ── AI Features ────────────────────────────────────────────

export interface AiFeature {
  route: string;                 // "/chat"
  type: 'chat' | 'search' | 'summarize' | 'generate' | 'other';
  inputDescription: string;      // "Natural language query about emails"
  outputDescription: string;     // "AI-generated answer with source citations"
  modes: string[];               // ["Quick", "Deep Think"]
  expectedLatency: string;       // "5-30 seconds"
  qualityCriteria: string[];     // ["Response references actual email content", "Citations are valid"]
}

// ── Test Scenarios ─────────────────────────────────────────

export interface TestScenario {
  feature: string;               // "AI Chat"
  route: string;                 // "/chat"
  purpose: string;               // "Query emails using natural language"
  scenarios: Scenario[];
}

export interface Scenario {
  id: string;                    // "chat-budget-query"
  name: string;                  // "Ask about Q4 budget emails"
  reasoning: string;             // "The app has budget emails in seed data, this tests core AI feature"
  priority: 'critical' | 'high' | 'medium' | 'low';
  steps: ScenarioStep[];
  expectedBehavior: string;      // "Response should mention budget-related email content"
  qualityChecks: QualityCheck[];
  timeout: number;               // 30000 for AI features
  prerequisites: string[];       // ["Click '+ New conversation'"]
}

export interface ScenarioStep {
  action: 'goto' | 'fill' | 'click' | 'press' | 'wait' | 'assert-visible' | 'assert-text' | 'assert-url';
  target?: string;               // selector or placeholder text
  value?: string;                // input value or expected text
  description: string;           // "Type a query about Q4 budget"
  timeout?: number;
}

export interface QualityCheck {
  type: 'relevance' | 'completeness' | 'citations' | 'timing' | 'no-error' | 'content-length';
  description: string;           // "Response should reference budget-related content"
  assertion: string;             // "expect(text).toMatch(/budget|Q4|financial/i)"
}
