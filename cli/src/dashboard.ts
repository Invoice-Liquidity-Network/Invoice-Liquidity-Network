/**
 * CLI Dashboard
 *
 * Terminal dashboard UI for real-time invoice activity and metrics.
 */

import pc from 'picocolors';
import { formatAmount } from './amounts';
import { formatTimestamp } from './dates';
import { ILNClient } from './client';
import type { ListedInvoice, ResolvedConfig } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DashboardConfig {
  refreshIntervalMs?: number;
  maxItems?: number;
}

export type DashboardView = 'overview' | 'invoices' | 'stats' | 'activity';

interface DashboardState {
  currentView: DashboardView;
  invoices: ListedInvoice[];
  stats: ProtocolStats | null;
  activity: ActivityItem[];
  lastUpdate: number;
  isRunning: boolean;
}

interface ProtocolStats {
  totalInvoices: number;
  totalVolume: bigint;
  totalYield: bigint;
  defaultRate: number;
}

interface ActivityItem {
  timestamp: number;
  type: 'submit' | 'fund' | 'pay' | 'default';
  invoiceId: bigint;
  address: string;
  amount?: bigint;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export class Dashboard {
  private state: DashboardState;
  private config: Required<DashboardConfig>;
  private client: ILNClient;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private configData: ResolvedConfig;

  constructor(client: ILNClient, config: ResolvedConfig, dashboardConfig: DashboardConfig = {}) {
    this.client = client;
    this.configData = config;
    this.config = {
      refreshIntervalMs: dashboardConfig.refreshIntervalMs ?? 5000,
      maxItems: dashboardConfig.maxItems ?? 20,
    };

    this.state = {
      currentView: 'overview',
      invoices: [],
      stats: null,
      activity: [],
      lastUpdate: 0,
      isRunning: false,
    };
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Start the dashboard.
   */
  async start(): Promise<void> {
    this.state.isRunning = true;
    this.setupKeyboardHandlers();
    await this.refresh();
    this.startAutoRefresh();
    this.render();
  }

  /**
   * Stop the dashboard.
   */
  stop(): void {
    this.state.isRunning = false;
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.restoreTerminal();
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  private render(): void {
    if (!this.state.isRunning) return;

    this.clearScreen();
    this.renderHeader();
    this.renderView();
    this.renderFooter();
  }

  private clearScreen(): void {
    process.stdout.write('\x1b[2J\x1b[H');
  }

  private restoreTerminal(): void {
    process.stdout.write('\x1b[?25h');
    process.stdout.write('\x1b[0m');
  }

  private renderHeader(): void {
    const width = process.stdout.columns || 80;
    const title = 'ILN Dashboard';
    const network = this.configData.network;
    const timestamp = new Date().toLocaleTimeString();

    console.log(pc.bold(pc.cyan('═'.repeat(width))));
    console.log(pc.bold(pc.cyan(title.padStart((width + title.length) / 2))));
    console.log(pc.dim(`${network} | Last update: ${timestamp}`.padStart(width)));
    console.log(pc.bold(pc.cyan('═'.repeat(width))));
    console.log();
  }

  private renderView(): void {
    switch (this.state.currentView) {
      case 'overview':
        this.renderOverview();
        break;
      case 'invoices':
        this.renderInvoices();
        break;
      case 'stats':
        this.renderStats();
        break;
      case 'activity':
        this.renderActivity();
        break;
    }
  }

  private renderOverview(): void {
    console.log(pc.bold(pc.yellow('📊 Overview')));
    console.log();

    if (this.state.stats) {
      const stats = this.state.stats;
      this.renderRow('Total Invoices', stats.totalInvoices.toString());
      this.renderRow('Total Volume', formatAmount(stats.totalVolume));
      this.renderRow('Total Yield', formatAmount(stats.totalYield));
      this.renderRow('Default Rate', `${(stats.defaultRate * 100).toFixed(2)}%`);
    } else {
      console.log(pc.dim('  Loading stats...'));
    }

    console.log();
    console.log(pc.bold(pc.yellow('📋 Recent Invoices')));
    console.log();

    if (this.state.invoices.length === 0) {
      console.log(pc.dim('  No invoices found'));
    } else {
      const recent = this.state.invoices.slice(0, 5);
      for (const invoice of recent) {
        const status = this.getStatusColor(invoice.status);
        console.log(
          `  ${pc.dim('#')}${invoice.id.toString().padEnd(8)} ${status(
            invoice.status.padEnd(10)
          )} ${formatAmount(invoice.amount).padEnd(15)} ${pc.dim(
            formatTimestamp(invoice.dueDate).slice(0, 10)
          )}`
        );
      }
    }
  }

  private renderInvoices(): void {
    console.log(pc.bold(pc.yellow('📋 Invoices')));
    console.log();

    if (this.state.invoices.length === 0) {
      console.log(pc.dim('  No invoices found'));
      return;
    }

    // Header
    const headers = ['ID', 'Status', 'Amount', 'Rate', 'Due', 'Freelancer'];
    console.log(pc.bold(headers.map((h) => h.padEnd(15)).join('')));
    console.log(pc.dim('─'.repeat(90)));

    // Rows
    for (const invoice of this.state.invoices) {
      const status = this.getStatusColor(invoice.status);
      console.log(
        [
          invoice.id.toString().padEnd(15),
          status(invoice.status.padEnd(15)),
          formatAmount(invoice.amount).padEnd(15),
          `${invoice.discountRate} bps`.padEnd(15),
          formatTimestamp(invoice.dueDate).slice(0, 10).padEnd(15),
          invoice.freelancer.slice(0, 8) + '...',
        ].join('')
      );
    }
  }

  private renderStats(): void {
    console.log(pc.bold(pc.yellow('📈 Protocol Statistics')));
    console.log();

    if (!this.state.stats) {
      console.log(pc.dim('  Loading stats...'));
      return;
    }

    const stats = this.state.stats;
    this.renderRow('Total Invoices', stats.totalInvoices.toString());
    this.renderRow('Total Volume', formatAmount(stats.totalVolume));
    this.renderRow('Total Yield', formatAmount(stats.totalYield));
    this.renderRow('Default Rate', `${(stats.defaultRate * 100).toFixed(2)}%`);
    this.renderRow('Avg Discount', this.calculateAvgDiscount());
    this.renderRow('Active LPs', this.countActiveLPs().toString());
  }

  private renderActivity(): void {
    console.log(pc.bold(pc.yellow('⚡ Recent Activity')));
    console.log();

    if (this.state.activity.length === 0) {
      console.log(pc.dim('  No recent activity'));
      return;
    }

    for (const item of this.state.activity.slice(0, this.config.maxItems)) {
      const time = new Date(item.timestamp).toLocaleTimeString();
      const type = this.getActivityColor(item.type);
      const amount = item.amount ? ` ${formatAmount(item.amount)}` : '';

      console.log(
        `  ${pc.dim(time)} ${type(item.type.toUpperCase().padEnd(8))} #${
          item.invoiceId
        }${amount} ${pc.dim(item.address.slice(0, 8) + '...')}`
      );
    }
  }

  private renderFooter(): void {
    const width = process.stdout.columns || 80;
    console.log();
    console.log(pc.bold(pc.cyan('─'.repeat(width))));
    console.log(
      pc.dim('Controls: [1] Overview  [2] Invoices  [3] Stats  [4] Activity  [R] Refresh  [Q] Quit')
    );
    console.log(pc.bold(pc.cyan('─'.repeat(width))));
  }

  private renderRow(label: string, value: string): void {
    console.log(`  ${pc.bold(label.padEnd(20))} ${value}`);
  }

  // ── Data Loading ──────────────────────────────────────────────────────────

  private async refresh(): Promise<void> {
    try {
      // Load stats
      this.state.stats = await this.loadStats();

      // Load invoices
      this.state.invoices = await this.loadInvoices();

      // Update timestamp
      this.state.lastUpdate = Date.now();
    } catch (error) {
      console.error(pc.red(`Failed to refresh: ${error}`));
    }
  }

  private async loadStats(): Promise<ProtocolStats | null> {
    try {
      // This would typically call the SDK or indexer API
      // For now, return mock data
      return {
        totalInvoices: this.state.invoices.length,
        totalVolume: this.state.invoices.reduce((sum, inv) => sum + BigInt(inv.amount), 0n),
        totalYield: 0n,
        defaultRate: 0,
      };
    } catch {
      return null;
    }
  }

  private async loadInvoices(): Promise<ListedInvoice[]> {
    try {
      // This would typically call the SDK client
      // For now, return empty array
      return [];
    } catch {
      return [];
    }
  }

  // ── Keyboard Handling ─────────────────────────────────────────────────────

  private setupKeyboardHandlers(): void {
    if (typeof process.stdin.setRawMode !== 'function') {
      return;
    }

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf-8');

    process.stdin.on('data', (key: string) => {
      this.handleKeyPress(key);
    });
  }

  private handleKeyPress(key: string): void {
    switch (key) {
      case '1':
        this.state.currentView = 'overview';
        this.render();
        break;
      case '2':
        this.state.currentView = 'invoices';
        this.render();
        break;
      case '3':
        this.state.currentView = 'stats';
        this.render();
        break;
      case '4':
        this.state.currentView = 'activity';
        this.render();
        break;
      case 'r':
      case 'R':
        this.refresh().then(() => this.render());
        break;
      case 'q':
      case 'Q':
      case '\u0003': // Ctrl+C
        this.stop();
        process.exit(0);
        break;
    }
  }

  // ── Auto Refresh ──────────────────────────────────────────────────────────

  private startAutoRefresh(): void {
    this.refreshTimer = setInterval(async () => {
      await this.refresh();
      this.render();
    }, this.config.refreshIntervalMs);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private getStatusColor(status: string): (text: string) => string {
    switch (status) {
      case 'Pending':
        return pc.yellow;
      case 'Funded':
        return pc.blue;
      case 'Paid':
        return pc.green;
      case 'Defaulted':
        return pc.red;
      default:
        return pc.white;
    }
  }

  private getActivityColor(type: string): (text: string) => string {
    switch (type) {
      case 'submit':
        return pc.cyan;
      case 'fund':
        return pc.blue;
      case 'pay':
        return pc.green;
      case 'default':
        return pc.red;
      default:
        return pc.white;
    }
  }

  private calculateAvgDiscount(): string {
    if (this.state.invoices.length === 0) return '0 bps';
    const total = this.state.invoices.reduce((sum, inv) => sum + inv.discountRate, 0);
    return `${Math.round(total / this.state.invoices.length)} bps`;
  }

  private countActiveLPs(): number {
    const funderSet = new Set(
      this.state.invoices.filter((inv) => inv.funder).map((inv) => inv.funder)
    );
    return funderSet.size;
  }

  /**
   * Export dashboard data to JSON.
   */
  exportData(): object {
    return {
      timestamp: new Date().toISOString(),
      network: this.configData.network,
      stats: this.state.stats,
      invoices: this.state.invoices,
      activity: this.state.activity,
    };
  }
}

// ---------------------------------------------------------------------------
// CLI Integration
// ---------------------------------------------------------------------------

/**
 * Create and run the dashboard.
 */
export async function runDashboard(
  client: ILNClient,
  config: ResolvedConfig,
  options: DashboardConfig = {}
): Promise<void> {
  const dashboard = new Dashboard(client, config, options);
  await dashboard.start();
}
