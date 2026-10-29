#!/usr/bin/env node
import { readdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const roots = ['packages', 'sdk', 'cli'];

function run() {
  for (const root of roots) {
    try {
      const entries = readdirSync(root, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const changelog = join(root, e.name, 'CHANGELOG.md');
        if (!existsSync(changelog)) {
          writeFileSync(changelog, `# Changelog for ${e.name}\n\nUnreleased\n\n- TODO: add release notes for this package.\n`);
          console.log(`Created ${changelog}`);
        }
      }
    } catch (err) {
      // ignore missing roots
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) run();
