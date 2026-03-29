import { build } from 'esbuild';

// When esbuild bundles CJS packages (like commander) into ESM, it generates a
// __require shim that needs a real `require` function. In ESM, `require` is
// undefined, so we inject one via createRequire.
const requireShim = `
import { createRequire as __esbuild_createRequire } from 'node:module';
import { fileURLToPath as __esbuild_fileURLToPath } from 'node:url';
const require = __esbuild_createRequire(import.meta.url);
`;

// Bundle the CLI into a single file with all deps inlined
await build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outfile: 'dist/cli.js',
  external: [
    'playwright',
    'playwright-core',
    '@playwright/test',
  ],
  banner: {
    js: '#!/usr/bin/env node\n' + requireShim,
  },
  sourcemap: true,
  minify: false, // keep readable for debugging
});

// Also build the library entry points (non-bundled, just transpile all source files)
import { readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

function collectTsFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
      files.push(...collectTsFiles(full));
    } else if (entry.isFile() && extname(entry.name) === '.ts' && !entry.name.endsWith('.test.ts')) {
      files.push(full);
    }
  }
  return files;
}

await build({
  entryPoints: collectTsFiles('src'),
  bundle: false,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outdir: 'dist',
  sourcemap: true,
});

console.log('Build complete');
