import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pc from 'picocolors';
import type { Ui } from './format';
import { createSpinner } from './progress';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface VersionInfo {
  current: string;
  latest?: string;
  isOutdated: boolean;
  changelogUrl?: string;
}

export class VersionManager {
  private readonly pkgPath: string;
  private readonly ui: Ui;

  constructor(ui: Ui) {
    this.ui = ui;
    // Walk up from dist/cli.js (or src/cli.ts in dev) to find package.json
    this.pkgPath = this.findPackageJson(__dirname);
  }

  /**
   * Returns the current version from package.json.
   */
  getCurrentVersion(): string {
    try {
      const pkg = JSON.parse(readFileSync(this.pkgPath, 'utf8'));
      return pkg.version || '0.0.0';
    } catch {
      return '0.0.0';
    }
  }

  /**
   * Checks for updates by querying a remote (mocked for now).
   * In a real app, this might hit npm or a GitHub API.
   */
  async checkForUpdates(): Promise<VersionInfo> {
    const current = this.getCurrentVersion();

    // For demonstration, we simulate that we are one version behind if we are at 0.1.0
    // In a real implementation, you'd fetch this from a registry.
    let latest = current;
    if (current === '0.1.0') {
      latest = '1.0.0';
    }

    const isOutdated = this.compareVersions(current, latest) < 0;

    return {
      current,
      latest,
      isOutdated,
      changelogUrl: 'https://github.com/invoice-liquidity-network/cli/blob/main/CHANGELOG.md',
    };
  }

  /**
   * Notifies the user if an update is available.
   */
  async notifyUpdateIfAvailable(): Promise<void> {
    try {
      const info = await this.checkForUpdates();
      if (info.isOutdated) {
        this.ui.info('');
        this.ui.info(
          pc.yellow(`Update available! ${pc.dim(info.current)} -> ${pc.green(info.latest)}`)
        );
        this.ui.info(pc.yellow(`Run ${pc.cyan('iln update')} to install the latest version.`));
        this.ui.info('');
      }
    } catch {
      // Ignore update check failures (e.g. offline)
    }
  }

  /**
   * Displays the changelog for the current or specified version.
   */
  async showChangelog(version?: string): Promise<void> {
    const target = version ?? this.getCurrentVersion();
    const changelogPath = join(__dirname, '..', '..', 'CHANGELOG.md');

    if (!existsSync(changelogPath)) {
      this.ui.error('Changelog file not found.');
      return;
    }

    const content = readFileSync(changelogPath, 'utf8');
    const sections = content.split(/^## /m);

    const versionHeader = target.startsWith('[') ? target : `[${target}]`;
    const section = sections.find((s) => s.startsWith(versionHeader));

    if (section) {
      this.ui.info(pc.bold(`\nChangelog for ${target}:`));
      this.ui.info(`## ${section.trim()}`);
    } else {
      this.ui.info(pc.yellow(`\nNo specific changelog entries found for version ${target}.`));
      this.ui.info(pc.dim('Showing recent changes:\n'));
      this.ui.info(
        sections
          .slice(1, 3)
          .map((s) => `## ${s.trim()}`)
          .join('\n\n')
      );
    }
  }

  /**
   * Performs an "auto-update". In this mock implementation, it just
   * simulates the process.
   */
  async performUpdate(targetVersion?: string): Promise<void> {
    const info = await this.checkForUpdates();
    const target = targetVersion ?? info.latest ?? info.current;

    if (target === info.current && !targetVersion) {
      this.ui.success('CLI is already up to date.');
      return;
    }

    this.ui.info(`Updating ILN CLI to ${pc.green(target)}...`);

    const spinner = createSpinner('Downloading update…');
    await new Promise((r) => setTimeout(r, 1500));
    spinner.stop();

    this.ui.success(`Successfully updated to version ${target}!`);
    this.ui.info(
      pc.dim(
        "Note: In a production environment, this would run 'npm install -g @invoice-liquidity/cli'"
      )
    );
  }

  /**
   * Simple semver comparison.
   * Returns -1 if v1 < v2, 1 if v1 > v2, 0 if v1 == v2.
   */
  private compareVersions(v1: string, v2: string): number {
    const p1 = v1.split('.').map(Number);
    const p2 = v2.split('.').map(Number);

    for (let i = 0; i < 3; i++) {
      if ((p1[i] || 0) < (p2[i] || 0)) return -1;
      if ((p1[i] || 0) > (p2[i] || 0)) return 1;
    }
    return 0;
  }

  private findPackageJson(startDir: string): string {
    let curr = startDir;
    while (curr !== dirname(curr)) {
      const p = join(curr, 'package.json');
      if (existsSync(p)) return p;
      curr = dirname(curr);
    }
    throw new Error('Could not find package.json');
  }
}
