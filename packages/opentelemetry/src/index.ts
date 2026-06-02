import { trace, metrics, SpanStatusCode, Tracer, Meter } from '@opentelemetry/api';
// Assuming SDK has a class ILNClient or similar. We will create a wrapper.
// The requirements say: "Instruments all SDK client methods with spans: method name, invoice ID, token, network, status"

export class ILNInstrumentation {
  private tracer: Tracer;
  private meter: Meter;
  private transactionDuration: any;
  private simulationDuration: any;
  private errorCount: any;

  constructor(options: { meterProvider?: any, tracerProvider?: any } = {}) {
    this.tracer = trace.getTracer('@invoice-liquidity/sdk');
    this.meter = metrics.getMeter('@invoice-liquidity/sdk');

    this.transactionDuration = this.meter.createHistogram('iln.transaction.duration', {
      description: 'Duration of ILN transactions',
      unit: 'ms',
    });

    this.simulationDuration = this.meter.createHistogram('iln.simulation.duration', {
      description: 'Duration of ILN transaction simulations',
      unit: 'ms',
    });

    this.errorCount = this.meter.createCounter('iln.error.count', {
      description: 'Count of ILN errors',
    });
  }

  /**
   * Wraps an SDK client instance with OpenTelemetry instrumentation.
   * We intercept method calls on the client.
   */
  public instrumentClient<T extends Record<string, any>>(client: T): T {
    const instrumented = { ...client };
    const prototype = Object.getPrototypeOf(client);
    
    const methods = Object.getOwnPropertyNames(prototype).filter(
      p => typeof client[p] === 'function' && p !== 'constructor'
    );

    for (const method of methods) {
      const original = client[method];
      
      (instrumented as any)[method] = async (...args: any[]) => {
        const span = this.tracer.startSpan(`ILNClient.${method}`);
        const startTime = Date.now();

        // Try to extract invoiceId, token, network if present in args (usually arg 0 is params)
        const params = args[0] || {};
        if (params.invoiceId) span.setAttribute('invoice_id', params.invoiceId);
        if (params.token) span.setAttribute('token', params.token);
        if (params.network) span.setAttribute('network', params.network);

        try {
          const result = await original.apply(client, args);
          span.setStatus({ code: SpanStatusCode.OK });
          span.setAttribute('status', 'success');
          
          const duration = Date.now() - startTime;
          if (method.includes('simulate')) {
            this.simulationDuration.record(duration, { method });
          } else {
            this.transactionDuration.record(duration, { method });
          }
          
          return result;
        } catch (error: any) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error.message,
          });
          span.setAttribute('status', 'error');
          
          const errorCode = error.code || 'UNKNOWN_ERROR';
          this.errorCount.add(1, { method, code: errorCode });
          
          throw error;
        } finally {
          span.end();
        }
      };
    }
    
    return instrumented as T;
  }
}
