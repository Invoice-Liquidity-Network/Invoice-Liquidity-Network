import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ILNInstrumentation } from '../src/index';
import { trace, metrics } from '@opentelemetry/api';

vi.mock('@opentelemetry/api', () => {
  const startSpan = vi.fn().mockReturnValue({
    setAttribute: vi.fn(),
    setStatus: vi.fn(),
    end: vi.fn(),
  });
  
  const record = vi.fn();
  const add = vi.fn();

  return {
    SpanStatusCode: {
      OK: 1,
      ERROR: 2,
    },
    trace: {
      getTracer: vi.fn().mockReturnValue({
        startSpan,
      }),
    },
    metrics: {
      getMeter: vi.fn().mockReturnValue({
        createHistogram: vi.fn().mockReturnValue({ record }),
        createCounter: vi.fn().mockReturnValue({ add }),
      }),
    },
  };
});

class MockClient {
  async submitInvoice(params: any) {
    return { success: true };
  }
  
  async simulateTransaction(params: any) {
    return { success: true };
  }
  
  async fundInvoice(params: any) {
    throw Object.assign(new Error('Insufficient balance'), { code: 'INSUFFICIENT_BALANCE' });
  }
}

describe('ILNInstrumentation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('instruments client methods successfully', async () => {
    const instrumentation = new ILNInstrumentation();
    const client = new MockClient();
    const instrumented = instrumentation.instrumentClient(client);

    await instrumented.submitInvoice({ invoiceId: '123', token: 'USDC', network: 'testnet' });

    const tracer = trace.getTracer('test');
    expect(tracer.startSpan).toHaveBeenCalledWith('ILNClient.submitInvoice');
    
    // Check that histogram was recorded
    const meter = metrics.getMeter('test');
    const histogram = meter.createHistogram('iln.transaction.duration');
    expect(histogram.record).toHaveBeenCalled();
  });

  it('records simulation duration differently', async () => {
    const instrumentation = new ILNInstrumentation();
    const client = new MockClient();
    const instrumented = instrumentation.instrumentClient(client);

    await instrumented.simulateTransaction({ invoiceId: '456' });

    const meter = metrics.getMeter('test');
    const histogram = meter.createHistogram('iln.simulation.duration');
    expect(histogram.record).toHaveBeenCalled();
  });

  it('records errors', async () => {
    const instrumentation = new ILNInstrumentation();
    const client = new MockClient();
    const instrumented = instrumentation.instrumentClient(client);

    await expect(instrumented.fundInvoice({ invoiceId: '789' })).rejects.toThrow('Insufficient balance');

    const meter = metrics.getMeter('test');
    const counter = meter.createCounter('iln.error.count');
    expect(counter.add).toHaveBeenCalledWith(1, { method: 'fundInvoice', code: 'INSUFFICIENT_BALANCE' });
  });
});
