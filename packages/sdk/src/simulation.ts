import { rpc } from '@stellar/stellar-sdk';

import { parseContractError, SimulationError } from './errors';

/**
 * Options controlling Soroban transaction simulation.
 */
export interface SimulationOptions {
  /** Run Soroban simulation before submitting the mutation. Defaults to true. */
  simulate?: boolean;
}

/**
 * Minimal RPC surface required by the simulation pre-flight.
 */
export interface SimulationServer<T = unknown> {
  simulateTransaction(transaction: T): Promise<SimulationResponse>;
}

/**
 * Shape of the Soroban RPC simulation response used by this helper.
 */
export interface SimulationResponse {
  error?: unknown;
  result?: unknown;
  [key: string]: unknown;
}

function simulationFailure(response: SimulationResponse): unknown {
  if (response.error !== undefined && response.error !== null) {
    return response.error;
  }

  if (response.result && typeof response.result === 'object' && 'error' in response.result) {
    return (response.result as { error: unknown }).error;
  }

  return undefined;
}

/**
 * Runs Soroban simulation for a state-changing transaction and applies the
 * simulation output to the transaction that will be signed.
 *
 * `rpc.assembleTransaction` copies the simulated authorization entries,
 * resource footprint, resource limits, and resource fee into the resulting
 * transaction. When simulation is disabled, the original transaction is
 * returned unchanged so callers can batch mutations without an RPC call.
 */
export async function preflightMutation<T>(
  server: SimulationServer<T>,
  transaction: T,
  options: SimulationOptions = {}
): Promise<T> {
  if (options.simulate === false) {
    return transaction;
  }

  let response: SimulationResponse;
  try {
    response = await server.simulateTransaction(transaction);
  } catch (cause) {
    const error = new SimulationError('Transaction simulation failed.');
    error.context = { cause };
    error.cause = cause;
    throw error;
  }

  const failure = simulationFailure(response);
  if (failure !== undefined) {
    const decoded = parseContractError(failure);
    const error = new SimulationError(decoded.message);
    error.context = {
      rawError: failure,
      decodedError: decoded,
      simulation: response,
    };
    error.cause = decoded;
    throw error;
  }

  try {
    return rpc
      .assembleTransaction(
        transaction as Parameters<typeof rpc.assembleTransaction>[0],
        response as Parameters<typeof rpc.assembleTransaction>[1]
      )
      .build() as T;
  } catch (cause) {
    const error = new SimulationError('Unable to apply Soroban simulation results.');
    error.context = { simulation: response, cause };
    error.cause = cause;
    throw error;
  }
}
