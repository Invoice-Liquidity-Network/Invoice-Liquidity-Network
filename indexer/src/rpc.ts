import {
  Account,
  Address,
  nativeToScVal,
  Operation,
  rpc,
  scValToNative,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import type { Transaction } from '@stellar/stellar-sdk';
import { CONFIG } from './config';
import { rpcFailoversTotal, rpcRequestsTotal } from './metrics';
import type { Invoice } from './types';

/*
 * RPC transport: timeouts, failover and outcome classification (#1454)
 * --------------------------------------------------------------------
 * Every call the indexer makes to Soroban RPC is a read (`getEvents`,
 * `getLatestLedger`, `simulateTransaction`); the indexer never submits
 * transactions. Retrying a read on another node is therefore safe: a request
 * whose outcome is unknown (timed out, connection reset) has no side effect.
 *
 * Each call is classified as:
 *  - success          → returned to the caller.
 *  - rpc_error        → the node answered with a JSON-RPC error object. The
 *                       node is reachable and the answer is deterministic
 *                       (e.g. startLedger outside retention), so it is
 *                       rethrown as-is without failover.
 *  - timeout          → no answer within RPC_TIMEOUT_MS. Outcome unknown;
 *                       failover to the next endpoint.
 *  - transport_error  → network/HTTP failure. Failover to the next endpoint.
 *
 * When every endpoint fails, `RpcUnavailableError` is thrown. Callers must
 * treat that as "unknown", never as "not found".
 *
 * Endpoints are tried in order starting from the last one that answered
 * (sticky), so a dead primary costs one timeout per failover rather than one
 * per request. The indexer does not fail back to the primary until the
 * current endpoint fails. Endpoint URLs are never logged or used as metric
 * labels because they can carry API keys; endpoints are named by role.
 *
 * Full audit: docs/indexer/observability-audit.md
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type RpcOperation = 'getEvents' | 'getLatestLedger' | 'simulateTransaction';

/** The subset of `rpc.Server` the indexer uses. All calls are reads. */
export interface RpcReadClient {
  getEvents(request: rpc.Api.GetEventsRequest): Promise<rpc.Api.GetEventsResponse>;
  getLatestLedger(): Promise<rpc.Api.GetLatestLedgerResponse>;
  simulateTransaction(tx: Transaction): Promise<rpc.Api.SimulateTransactionResponse>;
}

export interface RpcEndpoint {
  /** `primary`, `fallback_1`, … — used in logs and metric labels instead of the URL. */
  role: string;
  client: RpcReadClient;
}

export interface FailoverClient extends RpcReadClient {
  /** Role of the endpoint the next call will try first. */
  activeEndpoint(): string;
}

export class RpcTimeoutError extends Error {
  constructor(
    readonly operation: RpcOperation,
    readonly endpoint: string,
    readonly timeoutMs: number
  ) {
    super(`[rpc] ${operation} on ${endpoint} timed out after ${timeoutMs}ms (outcome unknown)`);
    this.name = 'RpcTimeoutError';
  }
}

export interface RpcAttemptFailure {
  endpoint: string;
  outcome: 'timeout' | 'transport_error';
  message: string;
}

export class RpcUnavailableError extends Error {
  constructor(
    readonly operation: RpcOperation,
    readonly failures: RpcAttemptFailure[]
  ) {
    super(
      `[rpc] ${operation} failed on all ${failures.length} endpoint(s): ` +
        failures.map((f) => `${f.endpoint}=${f.outcome}`).join(', ')
    );
    this.name = 'RpcUnavailableError';
  }
}

// ─── Classification helpers ───────────────────────────────────────────────────

/**
 * True for a JSON-RPC error object (`{ code, message }`) as thrown by
 * stellar-sdk when the node answered with an error. Transport failures are
 * `Error` instances (axios/fetch) and are not application errors.
 */
export function isRpcApplicationError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    !(err instanceof Error) &&
    typeof (err as { code?: unknown }).code === 'number' &&
    typeof (err as { message?: unknown }).message === 'string'
  );
}

/** Run `fn`, rejecting with `onTimeout()` if it does not settle within `ms`. */
export function withTimeout<T>(fn: () => Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout()), ms);
    let pending: Promise<T>;
    try {
      pending = fn();
    } catch (err) {
      clearTimeout(timer);
      reject(err);
      return;
    }
    pending.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message.split('\n', 1)[0].slice(0, 200);
  return String(err).slice(0, 200);
}

function count(endpoint: string, operation: RpcOperation, outcome: string): void {
  try {
    rpcRequestsTotal.inc({ endpoint, operation, outcome });
  } catch {
    /* metrics failure is non-fatal */
  }
}

// ─── Failover client ──────────────────────────────────────────────────────────

export function createFailoverClient(
  endpoints: RpcEndpoint[],
  options: { timeoutMs: number }
): FailoverClient {
  if (endpoints.length === 0) {
    throw new Error('[rpc] at least one RPC endpoint is required');
  }
  const timeoutMs = options.timeoutMs;
  let active = 0;

  async function call<T>(
    operation: RpcOperation,
    invoke: (client: RpcReadClient) => Promise<T>
  ): Promise<T> {
    const failures: RpcAttemptFailure[] = [];
    const start = active;
    for (let k = 0; k < endpoints.length; k++) {
      const index = (start + k) % endpoints.length;
      const { role, client } = endpoints[index];
      try {
        const result = await withTimeout(
          () => invoke(client),
          timeoutMs,
          () => new RpcTimeoutError(operation, role, timeoutMs)
        );
        count(role, operation, 'success');
        active = index;
        return result;
      } catch (err) {
        if (isRpcApplicationError(err)) {
          // The node answered; another node would give the same answer.
          count(role, operation, 'rpc_error');
          active = index;
          throw err;
        }
        const outcome = err instanceof RpcTimeoutError ? 'timeout' : 'transport_error';
        count(role, operation, outcome);
        failures.push({ endpoint: role, outcome, message: describe(err) });
        if (k < endpoints.length - 1) {
          try {
            rpcFailoversTotal.inc({ operation, from: role });
          } catch {
            /* metrics failure is non-fatal */
          }
          console.warn(`[rpc] ${operation} ${outcome} on ${role}; failing over`);
        }
      }
    }
    throw new RpcUnavailableError(operation, failures);
  }

  return {
    getEvents: (request) => call('getEvents', (c) => c.getEvents(request)),
    getLatestLedger: () => call('getLatestLedger', (c) => c.getLatestLedger()),
    simulateTransaction: (tx) => call('simulateTransaction', (c) => c.simulateTransaction(tx)),
    activeEndpoint: () => endpoints[active].role,
  };
}

// ─── Singleton RPC client ─────────────────────────────────────────────────────

function buildServer(url: string): rpc.Server {
  return new rpc.Server(url, {
    allowHttp: url.startsWith('http://'),
    // Also bound the underlying HTTP request so a timed-out call does not keep
    // a socket open after `withTimeout` has given up on it.
    timeout: CONFIG.rpcTimeoutMs,
  });
}

/**
 * Read-only RPC client used by the poller, processor and reconciliation.
 * Primary is `RPC_URL`; `RPC_FALLBACK_URLS` are tried in order after it.
 */
export const server: FailoverClient = createFailoverClient(
  [CONFIG.rpcUrl, ...CONFIG.rpcFallbackUrls].map((url, i) => ({
    role: i === 0 ? 'primary' : `fallback_${i}`,
    client: buildServer(url),
  })),
  { timeoutMs: CONFIG.rpcTimeoutMs }
);

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Well-known Stellar account used for read-only simulations.
 * It has sequence 0 on every network and never needs to actually exist on-chain
 * for simulation purposes.
 */
const DUMMY_ACCOUNT = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

// ─── Contract reader ──────────────────────────────────────────────────────────

/**
 * Fetch full invoice state from the Soroban RPC by calling `get_invoice(id)`.
 *
 * - Resolves to the invoice when the simulation succeeds.
 * - Resolves to `null` only when the contract itself answered without an
 *   invoice (simulation error, e.g. unknown id) or the answer could not be
 *   decoded.
 * - **Rejects** when no RPC endpoint answered (timeout / transport failure,
 *   `RpcUnavailableError`) or the node returned a JSON-RPC error. Before #1454
 *   these were swallowed and returned `null`, so the processor committed the
 *   event without invoice state and its retry loop never ran; the event was
 *   then deduplicated on replay and the invoice stayed stale.
 */
export async function fetchInvoice(
  id: number,
  client: RpcReadClient = server
): Promise<Omit<Invoice, 'created_at' | 'updated_at'> | null> {
  const account = new Account(DUMMY_ACCOUNT, '0');

  const tx = new TransactionBuilder(account, {
    fee: '1000',
    networkPassphrase: CONFIG.networkPassphrase,
  })
    .addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({
            contractAddress: Address.fromString(CONFIG.contractId).toScAddress(),
            functionName: 'get_invoice',
            args: [nativeToScVal(BigInt(id), { type: 'u64' })],
          })
        ),
        auth: [],
      })
    )
    .setTimeout(30)
    .build();

  // Transport failures propagate: the caller must not treat them as "not found".
  const sim = await client.simulateTransaction(tx);

  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) {
    return null;
  }

  try {
    const native = scValToNative(sim.result.retval) as Record<string, unknown>;

    return {
      id,
      freelancer: Address.fromScAddress(native.freelancer as xdr.ScAddress).toString(),
      payer: Address.fromScAddress(native.payer as xdr.ScAddress).toString(),
      amount: String(native.amount),
      due_date: Number(native.due_date),
      discount_rate: Number(native.discount_rate),
      status: parseStatus(native.status),
      funder: native.funder
        ? Address.fromScAddress(native.funder as xdr.ScAddress).toString()
        : null,
      funded_at: native.funded_at ? Number(native.funded_at) : null,
    };
  } catch (err) {
    console.error(`[rpc] Failed to decode invoice ${id}:`, describe(err));
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseStatus(raw: unknown): Invoice['status'] {
  const key = Object.keys(raw as object)[0];
  if (key === 'Funded') return 'Funded';
  if (key === 'Paid') return 'Paid';
  if (key === 'Defaulted') return 'Defaulted';
  return 'Pending';
}
