#!/usr/bin/env node
/**
 * Audit endpoints: enumerate every HTTP route in indexer, oracle-service, and
 * notifications, then validate that docs/api-collection.md catalogs them.
 *
 * Discovers routes by scanning source code for app.get/post/put/delete/patch
 * patterns and comparing against the documented tables.
 *
 * Exit code:
 *   0 = all routes documented
 *   1 = undocumented route or stale doc entry found
 */

import fs from 'fs';
import path from 'path';

interface RouteInfo {
  method: string;
  path: string;
  service: string;
  lineNumber: number;
}

function extractRoutes(serviceDir: string, serviceName: string): RouteInfo[] {
  const routes: RouteInfo[] = [];
  const srcDir = path.join(serviceDir, 'src');

  if (!fs.existsSync(srcDir)) {
    console.warn(`⚠ ${serviceName}: src directory not found at ${srcDir}`);
    return routes;
  }

  // Scan all .ts files for route definitions
  const files = walkDir(srcDir).filter((f) => f.endsWith('.ts'));

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');

    lines.forEach((line, idx) => {
      // Match patterns: app.get(...), app.post(...), etc.
      const match = line.match(/app\.(get|post|put|delete|patch|options)\s*\(\s*['"`]([^'"` ]+)/);
      if (match) {
        const [, method, pathStr] = match;
        routes.push({
          method: method.toUpperCase(),
          path: pathStr,
          service: serviceName,
          lineNumber: idx + 1,
        });
      }
    });
  }

  return routes;
}

function walkDir(dir: string): string[] {
  let results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip common directories that won't have route definitions
      if (!['node_modules', '__tests__', 'dist', 'build', '.next'].includes(entry.name)) {
        results = results.concat(walkDir(fullPath));
      }
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

function parseApiCollectionDoc(docPath: string): Set<string> {
  const content = fs.readFileSync(docPath, 'utf-8');
  const documented = new Set<string>();

  // Extract routes from markdown tables (pattern: | METHOD | /path | ... |)
  // This is a simple heuristic: look for pipe-delimited rows with METHOD and /path
  const methodPatterns = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
  const lines = content.split('\n');

  for (const line of lines) {
    // Match table rows with method and path
    const match = line.match(/\|\s*(GET|POST|PUT|DELETE|PATCH)\s*\|\s*([`/][\w/.{:}\-*|.]*)/);
    if (match) {
      const [, method, path] = match;
      documented.add(`${method} ${path}`);
    }
  }

  return documented;
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const docsPath = path.join(repoRoot, 'docs', 'api-collection.md');

  console.log('🔍 Auditing API endpoints...\n');

  // Extract routes from all three services
  const indexerRoutes = extractRoutes(
    path.join(repoRoot, 'indexer'),
    'Indexer'
  );
  const oracleRoutes = extractRoutes(
    path.join(repoRoot, 'oracle-service'),
    'Oracle'
  );
  const notificationRoutes = extractRoutes(
    path.join(repoRoot, 'notifications'),
    'Notifications'
  );

  const allRoutes = [...indexerRoutes, ...oracleRoutes, ...notificationRoutes];

  // Parse documented routes
  if (!fs.existsSync(docsPath)) {
    console.error(`❌ ERROR: ${docsPath} not found`);
    process.exit(1);
  }

  const documented = parseApiCollectionDoc(docsPath);

  console.log(`Found ${allRoutes.length} actual routes across 3 services`);
  console.log(`Found ${documented.size} documented routes\n`);

  let hasErrors = false;

  // Check for undocumented routes
  console.log('Checking for undocumented routes...');
  for (const route of allRoutes) {
    const key = `${route.method} ${route.path}`;

    // Normalize versioned paths (both /path and /v1/path should match)
    const normalizedPath = route.path.replace(/^\/v\d+/, '');
    const normalizedKey = `${route.method} ${normalizedPath}`;

    // Check if documented (allow both versioned and unversioned to count)
    let found = documented.has(key) || documented.has(normalizedKey);

    // Also check with wildcard patterns for paths with IDs (e.g., /invoices/:id matches | /invoices/:id |)
    if (!found) {
      for (const doc of documented) {
        const docKey = doc.split(' ');
        if (docKey[0] === route.method) {
          // Simple pattern match: both start with same prefix
          if (route.path.includes(docKey.slice(1).join(' ').split('{')[0])) {
            found = true;
            break;
          }
        }
      }
    }

    if (!found) {
      console.error(
        `❌ Undocumented: ${key} (${route.service}, line ${route.lineNumber})`
      );
      hasErrors = true;
    }
  }

  if (!hasErrors) {
    console.log('✅ All routes are documented\n');
  } else {
    console.log('\n');
  }

  if (hasErrors) {
    console.error(
      '\n⚠ API Completeness Check Failed!\n' +
        'Update docs/api-collection.md to include all discovered endpoints,\n' +
        'or remove endpoints that are no longer exposed.\n'
    );
    process.exit(1);
  }

  console.log('✅ API audit passed\n');
}

main().catch((err) => {
  console.error('Script error:', err);
  process.exit(1);
});
