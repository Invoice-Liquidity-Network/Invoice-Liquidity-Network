import { describe, expect, it, vi, afterEach } from 'vitest';

import {
  FederationResolutionError,
  ILNError,
  InvalidAmountError,
  InvalidContractResponseError,
  NotificationsApiError,
  OfflineQueueFullError,
  PluginError,
  SimulationPreparedXdrMismatchError,
  TransactionBuildError,
} from './errors';
import { parseAmount, formatAmount } from './amounts';
import { parseGovernanceProposal } from './governance-parser';
import { NotificationsClient, NotificationTrigger } from './notifications';
import { ILNEventEmitter } from './event-emitter';
import { PluginRegistry } from './plugins';
import { OfflineManager } from './offline';

const TOKEN = { decimals: 7, symbol: 'XLM' };

describe('Typed SDK error taxonomy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  type TypedErrorClass = new (
  message?: string,
  context?: Record<string, unknown>,
  remediation?: string
) => ILNError;

  const cases: Array<{ name: string; Class: TypedErrorClass; code: string; retryable: boolean }> = [
    { name: 'InvalidAmountError', Class: InvalidAmountError, code: 'INVALID_AMOUNT', retryable: false },
    {
      name: 'InvalidContractResponseError',
      Class: InvalidContractResponseError,
      code: 'INVALID_CONTRACT_RESPONSE',
      retryable: false,
    },
    { name: 'TransactionBuildError', Class: TransactionBuildError, code: 'TRANSACTION_BUILD_ERROR', retryable: false },
    {
      name: 'NotificationsApiError',
      Class: NotificationsApiError,
      code: 'NOTIFICATIONS_API_ERROR',
      retryable: true,
    },
    { name: 'PluginError', Class: PluginError, code: 'PLUGIN_ERROR', retryable: false },
    { name: 'OfflineQueueFullError', Class: OfflineQueueFullError, code: 'OFFLINE_QUEUE_FULL', retryable: false },
    {
      name: 'FederationResolutionError',
      Class: FederationResolutionError,
      code: 'FEDERATION_RESOLUTION_FAILED',
      retryable: false,
    },
  ];

  it('exposes stable codes, remediation and docs anchors on every new error class', () => {
    for (const { Class, code } of cases) {
      const err = new Class('test message', { field: 'x' });
      expect(err).toBeInstanceOf(ILNError);
      expect(err.code).toBe(code);
      expect(err.message).toBe('test message');
      expect(err.context).toEqual({ field: 'x' });
      expect(err.docsUrl).toContain(`docs/errors.md#${code.toLowerCase()}`);
    }
  });

  it('marks retryability correctly', () => {
    for (const { Class, retryable } of cases) {
      expect(new Class('m').retryable).toBe(retryable);
    }
  });

  it('amount parsing/formatting throws InvalidAmountError', () => {
    expect(() => parseAmount('1.2.3', TOKEN)).toThrow(InvalidAmountError);
    expect(() => parseAmount('abc', TOKEN)).toThrow(InvalidAmountError);
    expect(() => formatAmount(-1n, TOKEN)).toThrow(InvalidAmountError);
  });

  it('unparseable governance payloads throw InvalidContractResponseError', () => {
    expect(() => parseGovernanceProposal({ not: 'a proposal' })).toThrow(InvalidContractResponseError);
  });

  it('notifications API failures throw NotificationsApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'internal server error',
      })
    );

    const client = new NotificationsClient('https://notify.example.test');
    await expect(
      client.subscribeEmail('GBXGQJWVLWOYHFLVTKWV5FGHA3LNYY2JQKM7OAJAUEQFU6LQWSEUZDWF', 'a@example.com', [
        NotificationTrigger.InvoiceFunded,
      ])
    ).rejects.toBeInstanceOf(NotificationsApiError);
  });

  it('duplicate plugin registration throws PluginError', async () => {
    const registry = new PluginRegistry(new ILNEventEmitter());
    const plugin = { name: 'analytics-duo' };

    await registry.register(plugin);
    await expect(registry.register(plugin)).rejects.toBeInstanceOf(PluginError);
  });

  it('offline enqueue past capacity throws OfflineQueueFullError', () => {
    const manager = new OfflineManager({ maxQueueSize: 1 });

    manager.enqueue('markPaid', { invoiceId: 1n });
    expect(() => manager.enqueue('markPaid', { invoiceId: 2n })).toThrow(OfflineQueueFullError);
  });

  it('SimulationPreparedXdrMismatchError remains non-retryable', () => {
    const err = new SimulationPreparedXdrMismatchError('tampered');
    expect(err.code).toBe('SIMULATION_PREPARED_XDR_MISMATCH');
    expect(err.retryable).toBe(false);
  });
});