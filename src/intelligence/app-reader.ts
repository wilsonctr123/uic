/**
 * UIC Intelligence Layer — App Reader
 *
 * Reads the target application's codebase to build an AppUnderstanding.
 * Uses static file analysis only — no LLM calls. Framework-agnostic:
 * tries each detection method and uses whatever succeeds.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, resolve, basename, dirname, extname, relative } from 'path';
import {
  AppUnderstanding,
  FeatureMap,
  ApiEndpoint,
  DataModel,
  EntityInfo,
  AiFeature,
  TechStack,
} from './types.js';
import type { LLMClient } from './llm-client.js';
import type { LLMCache } from './llm-cache.js';

// ── Public API ─────────────────────────────────────────────

/**
 * Walk up from `startDir` to find the true project root.
 * A frontend subdir (e.g. web/) has package.json but the real root
 * has pyproject.toml, README.md, or a docs/ directory one or two levels up.
 */
function resolveProjectRoot(startDir: string): string {
  const dir = resolve(startDir);

  // Check if this looks like a frontend subdir: has package.json but parent has
  // pyproject.toml or README.md (indicating a monorepo / full-stack project)
  if (existsSync(join(dir, 'package.json'))) {
    for (const ancestor of [join(dir, '..'), join(dir, '..', '..')]) {
      const up = resolve(ancestor);
      if (up === dir) continue;
      const hasProjectMarker =
        existsSync(join(up, 'pyproject.toml')) ||
        existsSync(join(up, 'README.md')) ||
        existsSync(join(up, 'CLAUDE.md')) ||
        (existsSync(join(up, 'docs')) && statSync(join(up, 'docs')).isDirectory());
      if (hasProjectMarker) return up;
    }
  }

  return dir;
}

export async function readAppUnderstanding(projectRoot: string): Promise<AppUnderstanding> {
  const root = resolveProjectRoot(projectRoot);

  // 1. Read project docs (README.md, CLAUDE.md, docs/**/*.md)
  const docs = readProjectDocs(root);

  // 2. Detect tech stack from package.json, pyproject.toml, etc.
  const techStack = detectTechStack(root);

  // 3. Find and parse route definitions
  const features = discoverFeatures(root, techStack);

  // 4. Find and parse API endpoints
  const apiEndpoints = discoverApiEndpoints(root, techStack);

  // 5. Analyze data model (schema files, model files)
  const dataModel = analyzeDataModel(root, techStack);

  // 6. Identify AI features (imports of anthropic/openai, LLM-related code)
  const aiFeatures = identifyAiFeatures(root, features);

  // 7. Synthesize into understanding
  return {
    projectName: extractProjectName(root, docs),
    projectGoal: extractProjectGoal(docs),
    projectDescription: extractDescription(docs),
    techStack,
    features,
    dataModel,
    apiEndpoints,
    aiFeatures,
    seedDataDescription: describeSeedData(dataModel),
  };
}

// ── Document Reading ───────────────────────────────────────

interface ProjectDocs {
  readme: string;
  claudeMd: string;
  otherDocs: Map<string, string>;
}

function readProjectDocs(root: string): ProjectDocs {
  const docs: ProjectDocs = {
    readme: '',
    claudeMd: '',
    otherDocs: new Map(),
  };

  // Read README
  for (const name of ['README.md', 'readme.md', 'Readme.md', 'README.rst']) {
    const p = join(root, name);
    if (existsSync(p)) {
      docs.readme = safeReadFile(p);
      break;
    }
  }

  // Read CLAUDE.md
  for (const name of ['CLAUDE.md', 'claude.md']) {
    const p = join(root, name);
    if (existsSync(p)) {
      docs.claudeMd = safeReadFile(p);
      break;
    }
  }

  // Read docs directory
  const docsDir = join(root, 'docs');
  if (existsSync(docsDir) && statSync(docsDir).isDirectory()) {
    walkMarkdownFiles(docsDir, (filePath) => {
      const rel = relative(root, filePath);
      docs.otherDocs.set(rel, safeReadFile(filePath));
    });
  }

  return docs;
}

function walkMarkdownFiles(dir: string, callback: (path: string) => void, depth = 0): void {
  if (depth > 4) return; // limit recursion
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        walkMarkdownFiles(full, callback, depth + 1);
      } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') {
        callback(full);
      }
    }
  } catch {
    // directory not readable — skip
  }
}

// ── Tech Stack Detection ───────────────────────────────────

function detectTechStack(root: string): TechStack {
  const stack: TechStack = {
    frontend: 'unknown',
    backend: 'unknown',
    database: 'unknown',
    ai: [],
  };

  // Check package.json for frontend framework
  const pkgJson = readJson<PackageJson>(join(root, 'package.json'));
  if (pkgJson) {
    stack.frontend = detectFrontendFromPackageJson(pkgJson);
  }

  // Check nested web/package.json (monorepo pattern)
  if (stack.frontend === 'unknown') {
    const webPkg = readJson<PackageJson>(join(root, 'web', 'package.json'));
    if (webPkg) {
      stack.frontend = detectFrontendFromPackageJson(webPkg);
    }
  }

  // Check pyproject.toml for backend
  const pyproject = safeReadFile(join(root, 'pyproject.toml'));
  if (pyproject) {
    stack.backend = detectBackendFromPyproject(pyproject);
  }

  // Check requirements.txt as fallback
  if (stack.backend === 'unknown') {
    const reqTxt = safeReadFile(join(root, 'requirements.txt'));
    if (reqTxt) {
      stack.backend = detectBackendFromRequirements(reqTxt);
    }
  }

  // Check Gemfile for Ruby
  if (stack.backend === 'unknown') {
    const gemfile = safeReadFile(join(root, 'Gemfile'));
    if (gemfile) {
      if (gemfile.includes('rails')) stack.backend = 'Ruby on Rails';
      else if (gemfile.includes('sinatra')) stack.backend = 'Sinatra';
    }
  }

  // Check for Express/Node backend in package.json
  if (stack.backend === 'unknown' && pkgJson) {
    stack.backend = detectNodeBackend(pkgJson);
  }

  // Detect database
  stack.database = detectDatabase(root, pyproject, pkgJson);

  // Detect AI libraries
  stack.ai = detectAiLibraries(root, pyproject, pkgJson);

  return stack;
}

function detectFrontendFromPackageJson(pkg: PackageJson): string {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const parts: string[] = [];

  if (deps['react']) {
    const version = deps['react'].replace(/[\^~]/, '');
    const major = version.split('.')[0];
    parts.push(`React ${major}`);
  }
  if (deps['vue']) parts.push('Vue');
  if (deps['svelte']) parts.push('Svelte');
  if (deps['@angular/core']) parts.push('Angular');
  if (deps['next']) parts.push('Next.js');
  if (deps['nuxt']) parts.push('Nuxt');
  if (deps['vite']) parts.push('Vite');
  if (deps['webpack']) parts.push('Webpack');

  return parts.length > 0 ? parts.join(' + ') : 'unknown';
}

function detectBackendFromPyproject(content: string): string {
  const parts: string[] = [];
  if (/fastapi/i.test(content)) parts.push('FastAPI');
  if (/django/i.test(content)) parts.push('Django');
  if (/flask/i.test(content)) parts.push('Flask');
  if (/sqlalchemy/i.test(content)) parts.push('SQLAlchemy');
  if (/sqlmodel/i.test(content)) parts.push('SQLModel');
  return parts.length > 0 ? parts.join(' + ') : 'unknown';
}

function detectBackendFromRequirements(content: string): string {
  const parts: string[] = [];
  if (/^fastapi/im.test(content)) parts.push('FastAPI');
  if (/^django/im.test(content)) parts.push('Django');
  if (/^flask/im.test(content)) parts.push('Flask');
  if (/^sqlalchemy/im.test(content)) parts.push('SQLAlchemy');
  return parts.length > 0 ? parts.join(' + ') : 'unknown';
}

function detectNodeBackend(pkg: PackageJson): string {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps['express']) return 'Express';
  if (deps['fastify']) return 'Fastify';
  if (deps['koa']) return 'Koa';
  if (deps['hono']) return 'Hono';
  if (deps['@nestjs/core']) return 'NestJS';
  return 'unknown';
}

function detectDatabase(root: string, pyproject: string, pkg: PackageJson | null): string {
  const all = [
    pyproject,
    safeReadFile(join(root, 'requirements.txt')),
    pkg ? JSON.stringify(pkg.dependencies || {}) : '',
  ].join('\n');

  if (/prisma/i.test(all) && existsSync(join(root, 'prisma', 'schema.prisma'))) return 'PostgreSQL (Prisma)';
  if (/pg|postgres/i.test(all)) return 'PostgreSQL';
  if (/mysql2?[^a-z]/i.test(all)) return 'MySQL';
  if (/mongodb|mongoose/i.test(all)) return 'MongoDB';
  if (/sqlite|aiosqlite/i.test(all)) return 'SQLite';

  // Check for .db files
  try {
    const files = readdirSync(root);
    if (files.some(f => f.endsWith('.db') || f.endsWith('.sqlite') || f.endsWith('.sqlite3'))) {
      return 'SQLite';
    }
  } catch { /* skip */ }

  return 'unknown';
}

function detectAiLibraries(root: string, pyproject: string, pkg: PackageJson | null): string[] {
  const ai: string[] = [];
  const all = [
    pyproject,
    safeReadFile(join(root, 'requirements.txt')),
    pkg ? JSON.stringify({ ...pkg.dependencies, ...pkg.devDependencies }) : '',
  ].join('\n');

  if (/anthropic/i.test(all)) ai.push('Claude API');
  if (/openai/i.test(all)) ai.push('OpenAI');
  if (/langchain/i.test(all)) ai.push('LangChain');
  if (/llamaindex|llama.index|llama_index/i.test(all)) ai.push('LlamaIndex');
  if (/cohere/i.test(all)) ai.push('Cohere');
  if (/huggingface|transformers/i.test(all)) ai.push('Hugging Face');
  if (/replicate/i.test(all)) ai.push('Replicate');

  return ai;
}

// ── Feature Discovery ──────────────────────────────────────

function discoverFeatures(root: string, stack: TechStack): FeatureMap[] {
  const features: FeatureMap[] = [];

  // Try React router discovery
  if (/react/i.test(stack.frontend)) {
    features.push(...discoverReactRoutes(root));
  }

  // Try Next.js page discovery
  if (/next/i.test(stack.frontend)) {
    features.push(...discoverNextRoutes(root));
  }

  // Try Vue router discovery
  if (/vue/i.test(stack.frontend)) {
    features.push(...discoverVueRoutes(root));
  }

  // If nothing found yet, try all methods
  if (features.length === 0) {
    features.push(...discoverReactRoutes(root));
  }
  if (features.length === 0) {
    features.push(...discoverNextRoutes(root));
  }
  if (features.length === 0) {
    features.push(...discoverVueRoutes(root));
  }

  return features;
}

function discoverReactRoutes(root: string): FeatureMap[] {
  const features: FeatureMap[] = [];

  // Search common locations for router config
  const candidates = [
    join(root, 'src', 'App.tsx'),
    join(root, 'src', 'App.jsx'),
    join(root, 'src', 'app', 'App.tsx'),
    join(root, 'src', 'router.tsx'),
    join(root, 'src', 'routes.tsx'),
    join(root, 'src', 'router', 'index.tsx'),
    join(root, 'web', 'src', 'App.tsx'),
    join(root, 'web', 'src', 'App.jsx'),
    join(root, 'web', 'src', 'router.tsx'),
    join(root, 'web', 'src', 'routes.tsx'),
    join(root, 'web', 'src', 'router', 'index.tsx'),
    join(root, 'frontend', 'src', 'App.tsx'),
    join(root, 'client', 'src', 'App.tsx'),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const content = safeReadFile(candidate);
    if (!content) continue;

    // Match <Route path="..." element={<Component />} />
    const routeRegex = /<Route\s+[^>]*path=["']([^"']+)["'][^>]*(?:element\s*=\s*\{?\s*<(\w+)|component\s*=\s*\{?\s*(\w+))/g;
    let match: RegExpExecArray | null;
    while ((match = routeRegex.exec(content)) !== null) {
      const route = match[1];
      const componentName = match[2] || match[3] || 'Unknown';
      features.push(routeToFeatureMap(route, componentName));
    }

    // Match path: "/..." pattern (react-router config objects)
    const configRegex = /path:\s*["']([^"']+)["']\s*,\s*(?:element|component)\s*:\s*(?:<(\w+)|(\w+))/g;
    while ((match = configRegex.exec(content)) !== null) {
      const route = match[1];
      const componentName = match[2] || match[3] || 'Unknown';
      if (!features.some(f => f.route === route)) {
        features.push(routeToFeatureMap(route, componentName));
      }
    }

    if (features.length > 0) break; // found routes in this file
  }

  return features;
}

function discoverNextRoutes(root: string): FeatureMap[] {
  const features: FeatureMap[] = [];

  // Check pages/ directory (Next.js pages router)
  for (const base of [root, join(root, 'src')]) {
    const pagesDir = join(base, 'pages');
    if (existsSync(pagesDir) && statSync(pagesDir).isDirectory()) {
      walkPageFiles(pagesDir, pagesDir, features);
    }

    // Check app/ directory (Next.js app router)
    const appDir = join(base, 'app');
    if (existsSync(appDir) && statSync(appDir).isDirectory()) {
      walkAppRouterFiles(appDir, appDir, features);
    }
  }

  return features;
}

function walkPageFiles(dir: string, pagesRoot: string, features: FeatureMap[], depth = 0): void {
  if (depth > 5) return;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('_') && !entry.name.startsWith('.')) {
        walkPageFiles(full, pagesRoot, features, depth + 1);
      } else if (entry.isFile() && /\.(tsx?|jsx?)$/.test(entry.name) && !entry.name.startsWith('_')) {
        const rel = relative(pagesRoot, full);
        const route = '/' + rel
          .replace(/\.(tsx?|jsx?)$/, '')
          .replace(/\/index$/, '')
          .replace(/\[([^\]]+)\]/g, ':$1');
        const pageName = basename(entry.name, extname(entry.name));
        features.push(routeToFeatureMap(route || '/', pageName));
      }
    }
  } catch { /* skip */ }
}

function walkAppRouterFiles(dir: string, appRoot: string, features: FeatureMap[], depth = 0): void {
  if (depth > 5) return;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    const hasPage = entries.some(e => e.isFile() && /^page\.(tsx?|jsx?)$/.test(e.name));
    if (hasPage) {
      const rel = relative(appRoot, dir);
      const route = '/' + rel
        .replace(/\(([^)]+)\)\/?/g, '') // remove route groups
        .replace(/\[([^\]]+)\]/g, ':$1');
      const pageName = basename(dir) === '' ? 'Home' : basename(dir);
      features.push(routeToFeatureMap(route || '/', pageName));
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        walkAppRouterFiles(join(dir, entry.name), appRoot, features, depth + 1);
      }
    }
  } catch { /* skip */ }
}

function discoverVueRoutes(root: string): FeatureMap[] {
  const features: FeatureMap[] = [];
  const candidates = [
    join(root, 'src', 'router', 'index.ts'),
    join(root, 'src', 'router', 'index.js'),
    join(root, 'src', 'router.ts'),
    join(root, 'src', 'router.js'),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const content = safeReadFile(candidate);
    if (!content) continue;

    const routeRegex = /path:\s*["']([^"']+)["']\s*,\s*(?:name:\s*["'](\w+)["'])?/g;
    let match: RegExpExecArray | null;
    while ((match = routeRegex.exec(content)) !== null) {
      const route = match[1];
      const name = match[2] || pathToName(route);
      features.push(routeToFeatureMap(route, name));
    }

    if (features.length > 0) break;
  }

  return features;
}

function routeToFeatureMap(route: string, componentName: string): FeatureMap {
  const pageName = componentName.replace(/Page$|View$|Screen$/, '');
  return {
    route,
    pageName,
    purpose: `${pageName} page`,
    isAiFeature: false, // will be updated by identifyAiFeatures
    keyElements: [],
    expectedBehavior: `Renders the ${pageName} page`,
    relatedApiEndpoints: [],
    testPriority: route === '/' ? 'critical' : 'medium',
  };
}

function pathToName(route: string): string {
  const parts = route.split('/').filter(Boolean);
  if (parts.length === 0) return 'Home';
  const last = parts[parts.length - 1];
  return last.charAt(0).toUpperCase() + last.slice(1);
}

// ── API Endpoint Discovery ─────────────────────────────────

function discoverApiEndpoints(root: string, stack: TechStack): ApiEndpoint[] {
  const endpoints: ApiEndpoint[] = [];

  // FastAPI / Python
  if (/fastapi|flask|django/i.test(stack.backend)) {
    endpoints.push(...discoverPythonEndpoints(root));
  }

  // Express / Node
  if (/express|fastify|koa|hono|nestjs/i.test(stack.backend)) {
    endpoints.push(...discoverNodeEndpoints(root));
  }

  // If nothing found, try both
  if (endpoints.length === 0) {
    endpoints.push(...discoverPythonEndpoints(root));
  }
  if (endpoints.length === 0) {
    endpoints.push(...discoverNodeEndpoints(root));
  }

  return endpoints;
}

function discoverPythonEndpoints(root: string): ApiEndpoint[] {
  const endpoints: ApiEndpoint[] = [];
  const pyFiles = findFilesByExtension(root, ['.py'], ['venv', '.venv', 'node_modules', '__pycache__', '.git']);

  for (const filePath of pyFiles) {
    const content = safeReadFile(filePath);
    if (!content) continue;

    // FastAPI: @router.get("/path") or @app.get("/path")
    const decoratorRegex = /@(?:router|app)\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/gi;
    let match: RegExpExecArray | null;
    while ((match = decoratorRegex.exec(content)) !== null) {
      const method = match[1].toUpperCase();
      const path = match[2];
      endpoints.push({
        method,
        path,
        purpose: inferEndpointPurpose(method, path),
        requiresAuth: guessRequiresAuth(content, match.index),
        relatedFeature: guessRelatedFeature(path),
      });
    }

    // Django: path("api/...", view)
    const djangoRegex = /path\(\s*["']([^"']+)["']\s*,\s*(\w+)/g;
    while ((match = djangoRegex.exec(content)) !== null) {
      const path = '/' + match[1];
      if (path.includes('api')) {
        endpoints.push({
          method: 'GET', // Django urls don't specify method
          path,
          purpose: inferEndpointPurpose('GET', path),
          requiresAuth: false,
          relatedFeature: guessRelatedFeature(path),
        });
      }
    }
  }

  return endpoints;
}

function discoverNodeEndpoints(root: string): ApiEndpoint[] {
  const endpoints: ApiEndpoint[] = [];
  const jsFiles = findFilesByExtension(root, ['.ts', '.js', '.mjs'], ['node_modules', '.git', 'dist', 'build']);

  for (const filePath of jsFiles) {
    // Only check files that look like route/controller files
    const name = basename(filePath).toLowerCase();
    if (!name.includes('route') && !name.includes('controller') && !name.includes('api') && !name.includes('server')) {
      continue;
    }

    const content = safeReadFile(filePath);
    if (!content) continue;

    // Express-style: router.get("/path", ...) or app.get("/path", ...)
    const routeRegex = /(?:router|app)\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/gi;
    let match: RegExpExecArray | null;
    while ((match = routeRegex.exec(content)) !== null) {
      const method = match[1].toUpperCase();
      const path = match[2];
      endpoints.push({
        method,
        path,
        purpose: inferEndpointPurpose(method, path),
        requiresAuth: false,
        relatedFeature: guessRelatedFeature(path),
      });
    }
  }

  return endpoints;
}

function inferEndpointPurpose(method: string, path: string): string {
  const segments = path.split('/').filter(Boolean);
  const resource = segments.find(s => !s.startsWith(':') && !s.startsWith('{') && s !== 'api' && !/^v\d+$/.test(s)) || 'resource';
  const hasParam = path.includes(':') || path.includes('{');

  switch (method) {
    case 'GET': return hasParam ? `Get a specific ${resource}` : `List or query ${resource}`;
    case 'POST': return `Create or process ${resource}`;
    case 'PUT': case 'PATCH': return `Update ${resource}`;
    case 'DELETE': return `Delete ${resource}`;
    default: return `${method} ${resource}`;
  }
}

function guessRequiresAuth(content: string, position: number): boolean {
  // Look for auth-related decorators or middleware near the route definition
  const context = content.substring(Math.max(0, position - 200), position);
  return /auth|login|token|session|permission|protect/i.test(context);
}

function guessRelatedFeature(path: string): string {
  const segments = path.split('/').filter(s => s && !s.startsWith(':') && !s.startsWith('{') && s !== 'api' && !/^v\d+$/.test(s));
  return segments.length > 0 ? '/' + segments[0] : '/';
}

// ── Data Model Analysis ────────────────────────────────────

function analyzeDataModel(root: string, stack: TechStack): DataModel {
  const model: DataModel = {
    entities: [],
    recordCounts: {},
    sampleData: {},
  };

  // SQLAlchemy models
  if (/sqlalchemy|sqlmodel|fastapi|flask/i.test(stack.backend)) {
    model.entities.push(...discoverSqlAlchemyModels(root));
  }

  // Django models
  if (/django/i.test(stack.backend)) {
    model.entities.push(...discoverDjangoModels(root));
  }

  // Prisma schema
  const prismaSchema = join(root, 'prisma', 'schema.prisma');
  if (existsSync(prismaSchema)) {
    model.entities.push(...discoverPrismaModels(prismaSchema));
  }

  // If nothing found, try all methods
  if (model.entities.length === 0) {
    model.entities.push(...discoverSqlAlchemyModels(root));
  }
  if (model.entities.length === 0) {
    model.entities.push(...discoverDjangoModels(root));
  }

  return model;
}

function discoverSqlAlchemyModels(root: string): EntityInfo[] {
  const entities: EntityInfo[] = [];
  const pyFiles = findFilesByExtension(root, ['.py'], ['venv', '.venv', 'node_modules', '__pycache__', '.git']);

  for (const filePath of pyFiles) {
    const content = safeReadFile(filePath);
    if (!content) continue;

    // Match SQLAlchemy model classes: class Email(Base): or class Email(db.Model):
    const classRegex = /class\s+(\w+)\s*\([^)]*(?:Base|Model|DeclarativeBase)[^)]*\):/g;
    let classMatch: RegExpExecArray | null;
    while ((classMatch = classRegex.exec(content)) !== null) {
      const className = classMatch[1];
      const classStart = classMatch.index;

      // Find __tablename__
      const tableNameMatch = content.substring(classStart, classStart + 500).match(/__tablename__\s*=\s*["'](\w+)["']/);
      const tableName = tableNameMatch ? tableNameMatch[1] : className.toLowerCase() + 's';

      // Find Column definitions
      const classBody = extractClassBody(content, classStart);
      const columnRegex = /(\w+)\s*(?::\s*Mapped\[.*?\]\s*=\s*mapped_column|=\s*(?:Column|db\.Column|mapped_column))\s*\(/g;
      const keyFields: string[] = [];
      let colMatch: RegExpExecArray | null;
      while ((colMatch = columnRegex.exec(classBody)) !== null) {
        const fieldName = colMatch[1];
        if (!fieldName.startsWith('_')) {
          keyFields.push(fieldName);
        }
      }

      // Look for docstring
      const docMatch = classBody.match(/"""([^"]+)"""|'''([^']+)'''/);
      const description = docMatch ? (docMatch[1] || docMatch[2]).trim() : `${className} entity from ${basename(filePath)}`;

      entities.push({
        name: className,
        tableName,
        keyFields: keyFields.slice(0, 10), // limit to 10 fields
        description,
      });
    }
  }

  return entities;
}

function discoverDjangoModels(root: string): EntityInfo[] {
  const entities: EntityInfo[] = [];
  const pyFiles = findFilesByExtension(root, ['.py'], ['venv', '.venv', 'node_modules', '__pycache__', '.git']);

  for (const filePath of pyFiles) {
    if (!basename(filePath).includes('model')) continue;
    const content = safeReadFile(filePath);
    if (!content) continue;

    const classRegex = /class\s+(\w+)\s*\((?:models\.)?Model\):/g;
    let match: RegExpExecArray | null;
    while ((match = classRegex.exec(content)) !== null) {
      const className = match[1];
      const classBody = extractClassBody(content, match.index);

      const fieldRegex = /(\w+)\s*=\s*models\.\w+Field/g;
      const keyFields: string[] = [];
      let fieldMatch: RegExpExecArray | null;
      while ((fieldMatch = fieldRegex.exec(classBody)) !== null) {
        keyFields.push(fieldMatch[1]);
      }

      entities.push({
        name: className,
        tableName: className.toLowerCase() + 's',
        keyFields: keyFields.slice(0, 10),
        description: `${className} Django model`,
      });
    }
  }

  return entities;
}

function discoverPrismaModels(schemaPath: string): EntityInfo[] {
  const entities: EntityInfo[] = [];
  const content = safeReadFile(schemaPath);
  if (!content) return entities;

  const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = modelRegex.exec(content)) !== null) {
    const name = match[1];
    const body = match[2];

    const fields = body.split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('//') && !line.startsWith('@@'))
      .map(line => line.split(/\s+/)[0])
      .filter(Boolean);

    entities.push({
      name,
      tableName: name.toLowerCase() + 's',
      keyFields: fields.slice(0, 10),
      description: `${name} Prisma model`,
    });
  }

  return entities;
}

// ── AI Feature Identification ──────────────────────────────

function identifyAiFeatures(root: string, features: FeatureMap[]): AiFeature[] {
  const aiFeatures: AiFeature[] = [];
  const aiPatterns = /anthropic|openai|@anthropic-ai\/sdk|langchain|llama.index|claude|gpt|completion|embedding|chat.*model/i;

  // Scan source files for AI-related imports and usage
  const allFiles = [
    ...findFilesByExtension(root, ['.ts', '.tsx', '.js', '.jsx'], ['node_modules', '.git', 'dist', 'build']),
    ...findFilesByExtension(root, ['.py'], ['venv', '.venv', 'node_modules', '__pycache__', '.git']),
  ];

  const aiFiles = new Set<string>();
  for (const filePath of allFiles) {
    const content = safeReadFile(filePath);
    if (!content) continue;
    if (aiPatterns.test(content)) {
      aiFiles.add(filePath);
    }
  }

  // Try to map AI files to features/routes
  for (const feature of features) {
    const nameLower = feature.pageName.toLowerCase();
    const routeLower = feature.route.toLowerCase();

    // Check if any AI file relates to this feature
    const routeClean = routeLower.replace('/', '');
    const isAi = [...aiFiles].some(f => {
      const fLower = f.toLowerCase();
      return fLower.includes(nameLower) || (routeClean && fLower.includes(routeClean));
    });

    // Also check if the page name itself suggests AI (chat, ask, search with AI)
    const aiPagePatterns = /chat|conversation|assistant|copilot|ai|ask|agent/i;
    const isAiByName = aiPagePatterns.test(feature.pageName) || aiPagePatterns.test(feature.route);

    if (isAi || isAiByName) {
      feature.isAiFeature = true;
      feature.testPriority = 'critical';

      aiFeatures.push({
        route: feature.route,
        type: classifyAiFeatureType(feature.pageName, feature.route),
        inputDescription: `User input on ${feature.pageName} page`,
        outputDescription: `AI-generated response on ${feature.pageName} page`,
        modes: [],
        expectedLatency: '5-30 seconds',
        qualityCriteria: [
          'Response is relevant to the input',
          'No error messages displayed',
          'Response completes within expected time',
        ],
      });
    }
  }

  // If no features matched but we found AI code, create standalone AI features
  if (aiFeatures.length === 0 && aiFiles.size > 0) {
    aiFeatures.push({
      route: '/',
      type: 'other',
      inputDescription: 'Application uses AI capabilities',
      outputDescription: 'AI-generated content',
      modes: [],
      expectedLatency: '5-30 seconds',
      qualityCriteria: ['AI functionality works correctly'],
    });
  }

  return aiFeatures;
}

function classifyAiFeatureType(name: string, route: string): AiFeature['type'] {
  const combined = (name + ' ' + route).toLowerCase();
  if (combined.includes('chat') || combined.includes('conversation') || combined.includes('message')) return 'chat';
  if (combined.includes('search') || combined.includes('find') || combined.includes('query')) return 'search';
  if (combined.includes('summar') || combined.includes('digest') || combined.includes('brief')) return 'summarize';
  if (combined.includes('generat') || combined.includes('draft') || combined.includes('compose') || combined.includes('write')) return 'generate';
  return 'other';
}

// ── Info Extraction from Docs ──────────────────────────────

function extractProjectName(root: string, docs: ProjectDocs): string {
  // Check package.json name
  const pkg = readJson<PackageJson>(join(root, 'package.json'));
  if (pkg?.name) return pkg.name;

  // Check pyproject.toml
  const pyproject = safeReadFile(join(root, 'pyproject.toml'));
  if (pyproject) {
    const nameMatch = pyproject.match(/^name\s*=\s*["']([^"']+)["']/m);
    if (nameMatch) return nameMatch[1];
  }

  // From README heading
  if (docs.readme) {
    const headingMatch = docs.readme.match(/^#\s+(.+)/m);
    if (headingMatch) return headingMatch[1].trim();
  }

  // Fall back to directory name
  return basename(root);
}

function extractProjectGoal(docs: ProjectDocs): string {
  // Try README first — usually the cleanest project description
  if (docs.readme) {
    // Look for a description line after the title
    const descPatterns = [
      /(?:^|\n)(?:>|##?\s*(?:about|description|overview|what))\s*[:\-]?\s*\n?(.+)/im,
    ];
    for (const pattern of descPatterns) {
      const match = docs.readme.match(pattern);
      if (match) {
        const text = match[1].trim().replace(/\n/g, ' ');
        if (text.length > 10 && text.length <= 200) return text;
      }
    }
    // First non-heading, non-badge paragraph
    const paragraphs = docs.readme.split('\n\n').filter(p => {
      const t = p.trim();
      return t && !t.startsWith('#') && !t.startsWith('[!') && !t.startsWith('[![') && !t.startsWith('```');
    });
    if (paragraphs.length > 0) {
      const firstPara = paragraphs[0].trim().replace(/\n/g, ' ');
      if (firstPara.length <= 200) return firstPara;
      return firstPara.substring(0, 197) + '...';
    }
  }

  // Try CLAUDE.md — look for "Current Reality" or explicit description sections
  if (docs.claudeMd) {
    const claudePatterns = [
      /(?:current reality|the repository|this project)\s*[:\n]\s*\n?(.+?)(?:\n\n|\n-)/is,
      /(?:goal|purpose|mission|about)\s*[:\-]\s*(.+)/i,
    ];
    for (const pattern of claudePatterns) {
      const match = docs.claudeMd.match(pattern);
      if (match) {
        const text = match[1].trim().replace(/\n/g, ' ').replace(/\s+/g, ' ');
        if (text.length > 10) {
          return text.length <= 200 ? text : text.substring(0, 197) + '...';
        }
      }
    }
  }

  // Try docs/ directory
  for (const doc of docs.otherDocs) {
    const goalMatch = doc.content.match(/(?:goal|purpose|vision|overview)\s*[:\-]\s*(.+)/i);
    if (goalMatch) return goalMatch[1].trim().substring(0, 200);
  }

  return 'Unknown project goal';
}

function extractDescription(docs: ProjectDocs): string {
  if (docs.readme) {
    // Return up to 500 chars of README content (skip the title)
    const lines = docs.readme.split('\n');
    const afterTitle = lines.slice(lines.findIndex(l => l.startsWith('#')) + 1).join('\n').trim();
    if (afterTitle.length <= 500) return afterTitle;
    return afterTitle.substring(0, 497) + '...';
  }

  if (docs.claudeMd) {
    return docs.claudeMd.substring(0, 500);
  }

  return 'No project description available';
}

function describeSeedData(model: DataModel): string {
  if (model.entities.length === 0) return 'No data model detected';

  const entityNames = model.entities.map(e => e.name);
  const countEntries = Object.entries(model.recordCounts);

  if (countEntries.length > 0) {
    const parts = countEntries.map(([k, v]) => `${v} ${k}`);
    return `Data model includes: ${entityNames.join(', ')}. Known record counts: ${parts.join(', ')}.`;
  }

  return `Data model includes: ${entityNames.join(', ')}.`;
}

// ── Utility Functions ──────────────────────────────────────

function safeReadFile(filePath: string): string {
  try {
    if (!existsSync(filePath)) return '';
    const stat = statSync(filePath);
    if (!stat.isFile() || stat.size > 1_000_000) return ''; // skip files > 1MB
    return readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readJson<T>(filePath: string): T | null {
  const content = safeReadFile(filePath);
  if (!content) return null;
  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

function findFilesByExtension(
  root: string,
  extensions: string[],
  excludeDirs: string[],
  maxFiles = 200,
  maxDepth = 6,
): string[] {
  const results: string[] = [];

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth || results.length >= maxFiles) return;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= maxFiles) return;
        if (entry.name.startsWith('.')) continue;

        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!excludeDirs.includes(entry.name)) {
            walk(full, depth + 1);
          }
        } else if (entry.isFile() && extensions.includes(extname(entry.name).toLowerCase())) {
          results.push(full);
        }
      }
    } catch {
      // directory not readable — skip
    }
  }

  walk(root, 0);
  return results;
}

function extractClassBody(content: string, classStart: number): string {
  // Extract indented body after class declaration
  const afterClass = content.substring(classStart);
  const lines = afterClass.split('\n');
  if (lines.length < 2) return '';

  const bodyLines: string[] = [];
  let started = false;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    // Empty lines are part of the class body
    if (line.trim() === '') {
      if (started) bodyLines.push(line);
      continue;
    }
    // Indented lines are part of the class body
    if (/^\s/.test(line)) {
      started = true;
      bodyLines.push(line);
    } else if (started) {
      // Non-indented line after body started means class ended
      break;
    }
  }

  return bodyLines.join('\n');
}

// ── LLM-Powered App Understanding ─────────────────────────

const LLM_SYSTEM_PROMPT = `You are a senior QA engineer analyzing a webapp codebase. Read the documentation, route definitions, API endpoints, and data models. Return a JSON object with this exact structure:
{
  "projectName": "string",
  "projectGoal": "What is this app for? One sentence.",
  "projectDescription": "Longer description. 2-3 sentences.",
  "features": [{ "route": "/path", "pageName": "Name", "purpose": "What this page does and WHY a user would use it", "isAiFeature": true/false, "keyElements": ["element descriptions"], "expectedBehavior": "What should happen when a user interacts with this page", "testPriority": "critical|high|medium|low" }],
  "aiFeatures": [{ "route": "/path", "type": "chat|search|summarize|generate|other", "inputDescription": "What input the user provides", "outputDescription": "What the AI should return", "modes": ["mode names"], "expectedLatency": "time range", "qualityCriteria": ["How to judge if the output is good"] }]
}

Reason about BUSINESS PURPOSE, not technical implementation. For AI features, describe what QUALITY means.
Return ONLY valid JSON, no markdown fences or commentary.`;

/**
 * Build a context string for the LLM from project files.
 * Gathers README, CLAUDE.md, route definitions, API endpoints, data models,
 * and seed data config. Truncates to ~15K chars total.
 */
function buildLLMContext(root: string, docs: ProjectDocs, techStack: TechStack): string {
  const sections: string[] = [];

  // README (first 3000 chars)
  if (docs.readme) {
    sections.push('=== README.md ===\n' + docs.readme.substring(0, 3000));
  }

  // CLAUDE.md (first 3000 chars)
  if (docs.claudeMd) {
    sections.push('=== CLAUDE.md ===\n' + docs.claudeMd.substring(0, 3000));
  }

  // Tech stack summary
  sections.push(`=== Detected Tech Stack ===
Frontend: ${techStack.frontend}
Backend: ${techStack.backend}
Database: ${techStack.database}
AI: ${techStack.ai.length > 0 ? techStack.ai.join(', ') : 'none detected'}`);

  // Route definitions (App.tsx or similar — first 2000 chars)
  const routeFiles = [
    join(root, 'src', 'App.tsx'),
    join(root, 'src', 'App.jsx'),
    join(root, 'src', 'router.tsx'),
    join(root, 'src', 'routes.tsx'),
    join(root, 'web', 'src', 'App.tsx'),
    join(root, 'web', 'src', 'App.jsx'),
    join(root, 'web', 'src', 'router.tsx'),
    join(root, 'web', 'src', 'routes.tsx'),
    join(root, 'frontend', 'src', 'App.tsx'),
    join(root, 'client', 'src', 'App.tsx'),
  ];
  for (const rf of routeFiles) {
    if (existsSync(rf)) {
      const content = safeReadFile(rf);
      if (content) {
        sections.push(`=== Route Definitions (${basename(dirname(rf))}/${basename(rf)}) ===\n` + content.substring(0, 2000));
        break;
      }
    }
  }

  // API endpoint files (first 3000 chars of router/endpoint definitions)
  const apiFiles = findFilesByExtension(root, ['.py', '.ts', '.js'], ['venv', '.venv', 'node_modules', '__pycache__', '.git', 'dist', 'build'], 50, 4);
  let apiChars = 0;
  const apiLimit = 3000;
  for (const af of apiFiles) {
    const name = basename(af).toLowerCase();
    if (!name.includes('route') && !name.includes('router') && !name.includes('endpoint') && !name.includes('api') && !name.includes('controller')) continue;
    const content = safeReadFile(af);
    if (!content) continue;
    const remaining = apiLimit - apiChars;
    if (remaining <= 0) break;
    const snippet = content.substring(0, remaining);
    sections.push(`=== API: ${relative(root, af)} ===\n` + snippet);
    apiChars += snippet.length;
  }

  // Data model files (first 2000 chars of schema/model definitions)
  let modelChars = 0;
  const modelLimit = 2000;
  for (const mf of apiFiles) {
    const name = basename(mf).toLowerCase();
    if (!name.includes('model') && !name.includes('schema') && !name.includes('entity')) continue;
    const content = safeReadFile(mf);
    if (!content) continue;
    const remaining = modelLimit - modelChars;
    if (remaining <= 0) break;
    const snippet = content.substring(0, remaining);
    sections.push(`=== Model: ${relative(root, mf)} ===\n` + snippet);
    modelChars += snippet.length;
  }

  // Seed data config (uic.config.ts seeding section)
  const uicConfigFiles = [
    join(root, 'uic.config.ts'),
    join(root, 'web', 'uic.config.ts'),
  ];
  for (const cf of uicConfigFiles) {
    if (existsSync(cf)) {
      const content = safeReadFile(cf);
      if (content) {
        sections.push(`=== UIC Config (${basename(dirname(cf))}/${basename(cf)}) ===\n` + content.substring(0, 2000));
        break;
      }
    }
  }

  return sections.join('\n\n');
}

/**
 * Merge Claude's rich reasoning with heuristic structural data.
 * Claude provides better purpose/goal/feature descriptions;
 * heuristic provides reliable techStack, recordCounts, apiEndpoints.
 */
function mergeUnderstandings(
  llmResult: Partial<AppUnderstanding>,
  heuristic: AppUnderstanding,
): AppUnderstanding {
  // Start with heuristic as base (it has reliable structural data)
  const merged: AppUnderstanding = { ...heuristic };

  // Prefer LLM's reasoning for text fields (if non-empty)
  if (llmResult.projectName && llmResult.projectName !== 'string') {
    merged.projectName = llmResult.projectName;
  }
  if (llmResult.projectGoal && llmResult.projectGoal.length > 10) {
    merged.projectGoal = llmResult.projectGoal;
  }
  if (llmResult.projectDescription && llmResult.projectDescription.length > 10) {
    merged.projectDescription = llmResult.projectDescription;
  }

  // Merge features: prefer LLM descriptions, keep heuristic structure
  if (llmResult.features && Array.isArray(llmResult.features) && llmResult.features.length > 0) {
    const llmFeaturesByRoute = new Map<string, FeatureMap>();
    for (const f of llmResult.features) {
      if (f.route) llmFeaturesByRoute.set(f.route, f as FeatureMap);
    }

    // Update heuristic features with LLM descriptions
    merged.features = heuristic.features.map(hf => {
      const llmF = llmFeaturesByRoute.get(hf.route);
      if (!llmF) return hf;
      llmFeaturesByRoute.delete(hf.route);
      return {
        ...hf,
        purpose: llmF.purpose || hf.purpose,
        keyElements: (llmF.keyElements && llmF.keyElements.length > 0) ? llmF.keyElements : hf.keyElements,
        expectedBehavior: llmF.expectedBehavior || hf.expectedBehavior,
        isAiFeature: llmF.isAiFeature ?? hf.isAiFeature,
        testPriority: llmF.testPriority || hf.testPriority,
      };
    });

    // Add any features Claude found that heuristic missed
    for (const [, llmF] of llmFeaturesByRoute) {
      merged.features.push({
        route: llmF.route,
        pageName: llmF.pageName || pathToName(llmF.route),
        purpose: llmF.purpose || `${llmF.pageName || 'Unknown'} page`,
        isAiFeature: llmF.isAiFeature ?? false,
        keyElements: llmF.keyElements || [],
        expectedBehavior: llmF.expectedBehavior || '',
        relatedApiEndpoints: [],
        testPriority: llmF.testPriority || 'medium',
      });
    }
  }

  // Merge AI features: prefer LLM's richer descriptions
  if (llmResult.aiFeatures && Array.isArray(llmResult.aiFeatures) && llmResult.aiFeatures.length > 0) {
    const llmAiByRoute = new Map<string, AiFeature>();
    for (const af of llmResult.aiFeatures) {
      if (af.route) llmAiByRoute.set(af.route, af as AiFeature);
    }

    merged.aiFeatures = heuristic.aiFeatures.map(haf => {
      const llmAf = llmAiByRoute.get(haf.route);
      if (!llmAf) return haf;
      llmAiByRoute.delete(haf.route);
      return {
        ...haf,
        type: llmAf.type || haf.type,
        inputDescription: llmAf.inputDescription || haf.inputDescription,
        outputDescription: llmAf.outputDescription || haf.outputDescription,
        modes: (llmAf.modes && llmAf.modes.length > 0) ? llmAf.modes : haf.modes,
        expectedLatency: llmAf.expectedLatency || haf.expectedLatency,
        qualityCriteria: (llmAf.qualityCriteria && llmAf.qualityCriteria.length > 0) ? llmAf.qualityCriteria : haf.qualityCriteria,
      };
    });

    // Add any AI features Claude found that heuristic missed
    for (const [, llmAf] of llmAiByRoute) {
      merged.aiFeatures.push({
        route: llmAf.route,
        type: llmAf.type || 'other',
        inputDescription: llmAf.inputDescription || '',
        outputDescription: llmAf.outputDescription || '',
        modes: llmAf.modes || [],
        expectedLatency: llmAf.expectedLatency || '5-30 seconds',
        qualityCriteria: llmAf.qualityCriteria || [],
      });
    }
  }

  return merged;
}

/**
 * Use Claude (or another LLM) to understand the application.
 * Gathers raw materials from the codebase, sends them to the LLM,
 * and merges the result with heuristic analysis for reliability.
 */
export async function readAppUnderstandingWithLLM(
  projectRoot: string,
  llmClient: LLMClient,
  cache: LLMCache,
): Promise<AppUnderstanding> {
  // 1. Gather raw materials (reuse existing helper functions)
  const root = resolveProjectRoot(projectRoot);
  const docs = readProjectDocs(root);
  const techStack = detectTechStack(root);

  // 2. Build context for Claude (truncated to ~15K chars)
  const context = buildLLMContext(root, docs, techStack);

  // 3. Check cache
  const cached = cache.get(LLM_SYSTEM_PROMPT, context, 'understanding');
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      const heuristic = await readAppUnderstanding(projectRoot);
      return mergeUnderstandings(parsed, heuristic);
    } catch {
      // cache corrupted — fall through to LLM call
    }
  }

  // 4. Call the LLM
  const response = await llmClient.complete({
    system: LLM_SYSTEM_PROMPT,
    user: context,
    maxTokens: 4096,
    temperature: 0,
  });

  // 5. Parse response — strip markdown fences if present
  const cleaned = response.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();

  try {
    const parsed = JSON.parse(cleaned);
    // Merge with heuristic data for fields Claude might miss
    const heuristic = await readAppUnderstanding(projectRoot);
    const merged = mergeUnderstandings(parsed, heuristic);
    cache.set(LLM_SYSTEM_PROMPT, context, 'understanding', JSON.stringify(parsed));
    return merged;
  } catch {
    console.warn('Failed to parse LLM response, falling back to heuristic');
    return readAppUnderstanding(projectRoot);
  }
}
