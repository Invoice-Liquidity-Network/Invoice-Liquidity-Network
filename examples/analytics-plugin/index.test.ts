import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnalyticsPlugin } from './index';
import type { PluginContext } from '@iln/sdk';

function makeCtx(): PluginContext {
  return {
    logger: vi.fn(),
    emitter: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } as any,
    config: {},
  };
}

describe('AnalyticsPlugin', () => {
  let plugin: AnalyticsPlugin;
  let ctx: PluginContext;

  beforeEach(() => {
    plugin = new AnalyticsPlugin();
    ctx = makeCtx();
  });

  it('has the correct name and version', () => {
    expect(plugin.name).toBe('iln-analytics');
    expect(plugin.version).toBe('1.0.0');
  });

  it('installs without error and calls logger', async () => {
    await plugin.install(ctx);
    expect(ctx.logger).toHaveBeenCalledWith('Analytics plugin installed', expect.any(Object));
  });

  it('getReport returns empty object before any operations', async () => {
    await plugin.install(ctx);
    expect(plugin.getReport()).toEqual({});
  });

  it('tracks a successful operation count', async () => {
    await plugin.install(ctx);
    plugin.onBeforeOperation('submitInvoice', {});
    await plugin.onAfterOperation('submitInvoice', { id: 1 });

    const report = plugin.getReport();
    expect(report.submitInvoice.count).toBe(1);
    expect(report.submitInvoice.successCount).toBe(1);
    expect(report.submitInvoice.errorCount).toBe(0);
  });

  it('tracks error count on onError', async () => {
    await plugin.install(ctx);
    plugin.onBeforeOperation('fundInvoice', {});
    await plugin.onError('fundInvoice', new Error('tx failed'));

    const report = plugin.getReport();
    expect(report.fundInvoice.errorCount).toBe(1);
    expect(report.fundInvoice.successCount).toBe(0);
    expect(report.fundInvoice.count).toBe(1);
  });

  it('tracks multiple operations independently', async () => {
    await plugin.install(ctx);

    plugin.onBeforeOperation('submitInvoice', {});
    await plugin.onAfterOperation('submitInvoice', {});

    plugin.onBeforeOperation('fundInvoice', {});
    await plugin.onAfterOperation('fundInvoice', {});

    plugin.onBeforeOperation('submitInvoice', {});
    await plugin.onAfterOperation('submitInvoice', {});

    const report = plugin.getReport();
    expect(report.submitInvoice.count).toBe(2);
    expect(report.fundInvoice.count).toBe(1);
  });

  it('records a non-negative avgDurationMs after an operation', async () => {
    await plugin.install(ctx);
    plugin.onBeforeOperation('submitInvoice', {});
    await plugin.onAfterOperation('submitInvoice', {});

    expect(plugin.getReport().submitInvoice.avgDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('getReport returns a snapshot copy, not a live reference', async () => {
    await plugin.install(ctx);
    plugin.onBeforeOperation('op', {});
    await plugin.onAfterOperation('op', {});

    const snapshot = plugin.getReport();

    plugin.onBeforeOperation('op', {});
    await plugin.onAfterOperation('op', {});

    expect(snapshot.op.count).toBe(1);
  });

  it('destroy calls logger', async () => {
    await plugin.install(ctx);
    await plugin.destroy();
    expect(ctx.logger).toHaveBeenCalledWith('Analytics plugin destroyed');
  });

  it('onBeforeOperation and onAfterOperation can be called without install', async () => {
    plugin.onBeforeOperation('op', {});
    await expect(plugin.onAfterOperation('op', {})).resolves.toBeUndefined();
    expect(plugin.getReport().op.count).toBe(1);
  });

  it('accepts configuration for endpoint and batchSize', () => {
    const configured = new AnalyticsPlugin({
      endpoint: 'https://analytics.example.com/events',
      apiKey: 'secret',
      batchSize: 5,
    });
    expect(configured.name).toBe('iln-analytics');
  });
});
