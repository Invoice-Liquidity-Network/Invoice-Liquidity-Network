export class ILNError extends Error {
  public code: string;
  public remediation: string;

  constructor(message: string, code: string, remediation: string) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.remediation = remediation;
  }
}

export class InvalidDiscountRateError extends ILNError {
  constructor() { 
    super("Invalid discount rate provided.", "INVALID_DISCOUNT_RATE", "Ensure the discount rate is within the allowed bounds."); 
  }
}

export class TokenMismatchError extends ILNError {
  constructor() { 
    super("Token mismatch in transaction.", "TOKEN_MISMATCH", "Verify that the correct token addresses are being used."); 
  }
}

export class PayerReputationTooLowError extends ILNError {
  constructor() { 
    super("Payer reputation is too low.", "PAYER_REPUTATION_TOO_LOW", "The payer must improve their reputation score before proceeding."); 
  }
}

export class GenericContractError extends ILNError {
  constructor(rawError: string) { 
    super(`Contract error: ${rawError}`, "CONTRACT_ERROR", "Check contract logic or inputs."); 
  }
}

export class SimulationError extends ILNError {
  public readonly contractError: unknown;

  constructor(method: string, contractError: unknown) {
    const message = contractError instanceof Error ? contractError.message : String(contractError);
    super(
      `Simulation failed for ${method}: ${message}`,
      "SIMULATION_FAILED",
      "Inspect the decoded contract error and fix the transaction inputs before signing.",
    );
    this.contractError = contractError;
  }
}

export function parseContractError(xdrError: unknown): ILNError {
  const errorStr = typeof xdrError === 'string' ? xdrError : JSON.stringify(xdrError);
  if (errorStr.includes("InvalidDiscountRate")) return new InvalidDiscountRateError();
  if (errorStr.includes("TokenMismatch")) return new TokenMismatchError();
  if (errorStr.includes("PayerReputationTooLow")) return new PayerReputationTooLowError();
  return new GenericContractError(errorStr);
}
