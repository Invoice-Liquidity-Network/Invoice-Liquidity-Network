import {
  Account,
  Address,
  BASE_FEE,
  nativeToScVal,
  Operation,
  scValToNative,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";

import {
  GOVERNANCE_READ_ACCOUNT,
  GOVERNANCE_TX_TIMEOUT_SEC,
} from "./governance-constants";
import { ProposalActionKind, ProposalStatus } from "./governance-types";
import type { ProposalAction } from "./governance-types";
import type { RpcServerLike } from "./types";

export type BuiltTransaction = ReturnType<TransactionBuilder["build"]>;

export function buildReadContractTransaction(
  contractId: string,
  networkPassphrase: string,
  method: string,
  args: xdr.ScVal[],
): BuiltTransaction {
  return new TransactionBuilder(new Account(GOVERNANCE_READ_ACCOUNT, "0"), {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: contractId,
        function: method,
        args,
      }),
    )
    .setTimeout(GOVERNANCE_TX_TIMEOUT_SEC)
    .build();
}

export async function buildWriteContractTransaction(
  server: RpcServerLike,
  contractId: string,
  networkPassphrase: string,
  sourceAddress: string,
  method: string,
  args: xdr.ScVal[],
): Promise<BuiltTransaction> {
  const sourceAccount = (await server.getAccount(sourceAddress)) as Account;

  return new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: contractId,
        function: method,
        args,
      }),
    )
    .setTimeout(GOVERNANCE_TX_TIMEOUT_SEC)
    .build();
}

export function toAddressScVal(address: string): xdr.ScVal {
  return Address.fromString(address).toScVal();
}

export function toBytesN32ScVal(value: Buffer | Uint8Array): xdr.ScVal {
  const bytes = Buffer.from(value);
  if (bytes.length !== 32) {
    throw new Error(`Expected 32-byte hash but received ${bytes.length} bytes.`);
  }
  return xdr.ScVal.scvBytes(bytes);
}

export function toOptionalProposalStatusScVal(status?: ProposalStatus): xdr.ScVal {
  if (status === undefined) {
    return xdr.ScVal.scvVoid();
  }
  return xdr.ScVal.scvSymbol(status);
}

export function encodeProposalAction(action: ProposalAction): xdr.ScVal {
  switch (action.kind) {
    case ProposalActionKind.UpdateFeeRate:
      return xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol(action.kind),
        nativeToScVal(action.rate, { type: "u32" }),
      ]);
    case ProposalActionKind.AddToken:
      return xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol(action.kind),
        toAddressScVal(action.tokenAddress),
      ]);
    case ProposalActionKind.RemoveToken:
      return xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol(action.kind),
        toAddressScVal(action.tokenAddress),
      ]);
    case ProposalActionKind.UpdateMaxDiscountRate:
      return xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol(action.kind),
        nativeToScVal(action.rate, { type: "u32" }),
      ]);
    default: {
      const exhaustive: never = action;
      throw new Error(`Unsupported proposal action: ${JSON.stringify(exhaustive)}`);
    }
  }
}

type SimulationLike = {
  error?: unknown;
  result?: {
    retval?: xdr.ScVal;
  };
};

export function extractSimulationRetval(simulation: unknown, method: string): xdr.ScVal {
  const typedSimulation = simulation as SimulationLike;

  if (typedSimulation.error) {
    throw new Error(
      `Simulation failed for ${method}: ${typedSimulation.error ? String(typedSimulation.error) : "Unknown RPC error."}`,
    );
  }

  if (!typedSimulation.result?.retval) {
    throw new Error(`Simulation for ${method} did not return a contract result.`);
  }

  return typedSimulation.result.retval;
}

export function unwrapContractResult(value: unknown, method: string): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  if ("ok" in value) {
    return (value as { ok: unknown }).ok;
  }
  if ("Ok" in value) {
    return (value as { Ok: unknown }).Ok;
  }
  if ("err" in value) {
    throw new Error(
      `Contract method ${method} returned an error: ${formatContractError((value as { err: unknown }).err)}.`,
    );
  }
  if ("Err" in value) {
    throw new Error(
      `Contract method ${method} returned an error: ${formatContractError((value as { Err: unknown }).Err)}.`,
    );
  }

  return value;
}

function formatContractError(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (typeof error === "number" || typeof error === "bigint" || typeof error === "boolean") {
    return String(error);
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function extractContractCall(
  transaction: BuiltTransaction,
): { contractId: string; functionName: string; args: xdr.ScVal[] } {
  if (transaction.operations.length !== 1) {
    throw new Error("Transaction must contain exactly one operation.");
  }

  const operation = transaction.operations[0];
  if (!operation || operation.type !== "invokeHostFunction") {
    throw new Error("Transaction does not contain an invokeHostFunction operation.");
  }

  const hostFunction = operation.func;
  if (hostFunction.switch().name !== "hostFunctionTypeInvokeContract") {
    throw new Error("Transaction does not contain an invokeContract host function.");
  }

  const invokeContractArgs = hostFunction.invokeContract();
  const contractId = Address.fromScAddress(invokeContractArgs.contractAddress()).toString();
  const functionName = invokeContractArgs.functionName().toString();
  const args = invokeContractArgs.args();

  return { contractId, functionName, args };
}

export function scValToNativeValue(retval: xdr.ScVal): unknown {
  return scValToNative(retval);
}
