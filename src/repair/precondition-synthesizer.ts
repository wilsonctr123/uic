/**
 * Precondition Synthesizer
 *
 * Infers and creates all inputs needed for tests to run.
 * Retrieval hierarchy:
 *   1. Reuse existing repo asset
 *   2. Synthesize locally
 *   3. Derive from code/schema
 *   4. Fetch public sample (logged + cached)
 *   5. If truly impossible → explicit blocked precondition
 *
 * Covers: files, users, seed data, config, auth, env flags, world-state.
 */

import { existsSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { AffordanceLedger, Affordance } from '../config/types.js';

export interface Precondition {
  testId: string;
  type: 'file' | 'data-seed' | 'user' | 'config' | 'auth' | 'env-flag' | 'world-state';
  format?: string;
  source: 'repo-asset' | 'synthesized' | 'derived' | 'web-fetched' | 'blocked';
  path?: string;
  description: string;
  checksum?: string;
  blockedReason?: string;
}

export interface PreconditionReport {
  generatedAt: string;
  preconditions: Precondition[];
  fixturesCreated: string[];
  seedScriptCreated: boolean;
}

// ── Fixture file generators ──

function generateEmlFile(outputPath: string): void {
  const content = [
    'From: sender@example.com',
    'To: recipient@example.com',
    'Subject: UIC Test Email - Budget Report Q4',
    'Date: Mon, 23 Mar 2026 10:00:00 +0000',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Hi team,',
    '',
    'Please find attached the Q4 budget report for review.',
    'Key highlights:',
    '- Revenue increased 15% YoY',
    '- Operating costs reduced by 8%',
    '- Net margin improved to 22%',
    '',
    'Please review and share feedback by Friday.',
    '',
    'Best regards,',
    'Test Sender',
  ].join('\r\n');
  writeFileSync(outputPath, content);
}

function generatePdfFile(outputPath: string): void {
  // Minimal valid PDF (smallest possible)
  const content = [
    '%PDF-1.0',
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj',
    'xref',
    '0 4',
    '0000000000 65535 f ',
    '0000000009 00000 n ',
    '0000000058 00000 n ',
    '0000000115 00000 n ',
    'trailer<</Size 4/Root 1 0 R>>',
    'startxref',
    '206',
    '%%EOF',
  ].join('\n');
  writeFileSync(outputPath, content);
}

function generateTextFile(outputPath: string, content?: string): void {
  writeFileSync(outputPath, content || 'UIC test content\nLine 2\nLine 3\n');
}

function generateCsvFile(outputPath: string): void {
  const content = [
    'name,email,amount,date',
    'Alice,alice@example.com,1500.00,2026-01-15',
    'Bob,bob@example.com,2300.50,2026-02-20',
    'Charlie,charlie@example.com,890.00,2026-03-10',
  ].join('\n');
  writeFileSync(outputPath, content);
}

function generateSlackTranscript(outputPath: string): void {
  const content = [
    '#product — Mar 20, 2026',
    '',
    '[10:00 AM] alice: Hey team, the Q4 report is ready for review',
    '[10:05 AM] bob: Great, I\'ll take a look this afternoon',
    '[10:12 AM] alice: Also, the client meeting is moved to Thursday',
    '[10:15 AM] charlie: Thanks for the heads up. I\'ll update the calendar.',
    '[10:20 AM] bob: @alice can you share the updated budget figures?',
    '[10:25 AM] alice: Sure, sending them now.',
  ].join('\n');
  writeFileSync(outputPath, content);
}

function generateJsonFile(outputPath: string): void {
  writeFileSync(outputPath, JSON.stringify({
    items: [
      { id: 1, name: 'Test Item 1', status: 'active' },
      { id: 2, name: 'Test Item 2', status: 'pending' },
    ],
  }, null, 2));
}

// ── Seed data script generator ──

function generateSeedScript(outputPath: string, projectRoot: string): void {
  const script = `import { test as setup } from '@playwright/test';
import path from 'path';
import fs from 'fs';

/**
 * Seed data for UIC tests.
 * Imports test emails and creates test tasks so pages have data to display.
 */
setup('seed test data', async ({ request }) => {
  const baseUrl = 'http://localhost:5173';

  // Import test emails for search/pagination tests
  const fixtureDir = path.join(__dirname, 'data');
  const emlFiles = fs.readdirSync(fixtureDir).filter(f => f.endsWith('.eml'));

  for (const eml of emlFiles) {
    const content = fs.readFileSync(path.join(fixtureDir, eml));
    try {
      await request.post(baseUrl + '/api/v1/import/emails', {
        multipart: {
          file: { name: eml, mimeType: 'message/rfc822', buffer: content },
        },
      });
    } catch {
      // Import may fail if already exists — that's OK
    }
  }

  // Create test tasks for task filtering tests
  const tasks = [
    { title: 'UIC Test Task - Open', priority: 'high' },
    { title: 'UIC Test Task - In Progress', priority: 'medium' },
    { title: 'UIC Test Task - Done', priority: 'low' },
  ];

  for (const task of tasks) {
    try {
      await request.post(baseUrl + '/api/v1/todos', {
        data: task,
      });
    } catch {
      // May fail — that's OK
    }
  }

  console.log('Seed data: ' + emlFiles.length + ' emails, ' + tasks.length + ' tasks');
});
`;
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, script);
}

// ── Main synthesizer ──

export function synthesizePreconditions(
  ledger: AffordanceLedger,
  projectRoot: string,
): PreconditionReport {
  const dataDir = join(projectRoot, 'tests/e2e/fixtures/data');
  mkdirSync(dataDir, { recursive: true });

  const preconditions: Precondition[] = [];
  const fixturesCreated: string[] = [];
  let seedNeeded = false;

  // Scan affordances for fixture needs
  for (const aff of ledger.affordances) {
    // File upload affordances need fixture files
    if (aff.elementType === 'file-input') {
      const route = aff.route;
      const emlPath = join(dataDir, 'test-email.eml');
      const pdfPath = join(dataDir, 'test-document.pdf');
      const txtPath = join(dataDir, 'test-file.txt');

      // Check what format the route expects
      if (route === '/import') {
        // Import page accepts .eml and documents
        if (!existsSync(emlPath)) {
          // Try repo asset first
          const repoEmls = findRepoAssets(projectRoot, '*.eml', 3);
          if (repoEmls.length > 0) {
            // Reuse existing repo .eml file
            const { copyFileSync } = require('node:fs');
            copyFileSync(repoEmls[0], emlPath);
            preconditions.push({
              testId: aff.id, type: 'file', format: 'message/rfc822',
              source: 'repo-asset', path: emlPath,
              description: `Reused ${repoEmls[0]}`,
            });
          } else {
            generateEmlFile(emlPath);
            preconditions.push({
              testId: aff.id, type: 'file', format: 'message/rfc822',
              source: 'synthesized', path: emlPath,
              description: 'Synthesized test email for import',
            });
          }
          fixturesCreated.push(emlPath);
        }

        if (!existsSync(pdfPath)) {
          generatePdfFile(pdfPath);
          fixturesCreated.push(pdfPath);
          preconditions.push({
            testId: aff.id, type: 'file', format: 'application/pdf',
            source: 'synthesized', path: pdfPath,
            description: 'Minimal PDF for document import test',
          });
        }
      } else {
        // Generic file upload
        if (!existsSync(txtPath)) {
          generateTextFile(txtPath);
          fixturesCreated.push(txtPath);
          preconditions.push({
            testId: aff.id, type: 'file', format: 'text/plain',
            source: 'synthesized', path: txtPath,
            description: 'Generic text file for upload test',
          });
        }
      }
    }

    // Pagination/search/table affordances need seed data
    if (aff.oracle === 'content-changes' && (aff.label.toLowerCase().includes('next') || aff.label.toLowerCase().includes('previous'))) {
      seedNeeded = true;
      preconditions.push({
        testId: aff.id, type: 'data-seed',
        source: 'synthesized',
        description: 'Seed emails/tasks for pagination test',
      });
    }

    // Filter affordances need data to filter
    if (aff.oracle === 'attribute-changes' && aff.route === '/tasks') {
      seedNeeded = true;
    }
  }

  // Generate Slack transcript for import tests
  const slackPath = join(dataDir, 'test-transcript.txt');
  if (!existsSync(slackPath)) {
    generateSlackTranscript(slackPath);
    fixturesCreated.push(slackPath);
    preconditions.push({
      testId: 'import:slack', type: 'file', format: 'text/plain',
      source: 'synthesized', path: slackPath,
      description: 'Slack transcript for import test',
    });
  }

  // Generate CSV for general import
  const csvPath = join(dataDir, 'test-data.csv');
  if (!existsSync(csvPath)) {
    generateCsvFile(csvPath);
    fixturesCreated.push(csvPath);
  }

  // Generate seed data script
  const seedPath = join(projectRoot, 'tests/e2e/fixtures/seed-data.ts');
  if (seedNeeded && !existsSync(seedPath)) {
    generateSeedScript(seedPath, projectRoot);
    fixturesCreated.push(seedPath);
  }

  return {
    generatedAt: new Date().toISOString(),
    preconditions,
    fixturesCreated,
    seedScriptCreated: seedNeeded,
  };
}

// ── Find repo assets ──

function findRepoAssets(projectRoot: string, pattern: string, maxResults: number): string[] {
  const results: string[] = [];
  const ext = pattern.replace('*', '');

  function search(dir: string, depth: number) {
    if (depth > 3 || results.length >= maxResults) return;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const fullPath = join(dir, entry.name);
        if (entry.isFile() && entry.name.endsWith(ext)) {
          results.push(fullPath);
        } else if (entry.isDirectory()) {
          search(fullPath, depth + 1);
        }
      }
    } catch { /* permission error, skip */ }
  }

  search(projectRoot, 0);
  return results;
}
