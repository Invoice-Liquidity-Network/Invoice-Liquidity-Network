import { describe, it, expect } from "vitest";
import {
  ILNError,
  NetworkError,
  TimeoutError,
  SimulationError,
  ContractCallError,
  RPCResponseError,
  isRetryableError,
  normalizeError,
  toILNError,
} from "../errors";

describe("notifications ILNError", () => {
  it("creates error with structured fields", () => {
    const err = new ILNError("test", "TEST", "fix it", {
      retryable: true,
      context: { key: "value" },
    });
    expect(err.code).toBe("TEST");
    expect(err.remediation).toBe("fix it");
    expect(err.retryable).toBe(true);
    expect(err.context).toEqual({ key: "value" });
    expect(err).toBeInstanceOf(ILNError);
    expect(err).toBeInstanceOf(Error);
  });

  it("has unique error codes across all error classes", () => {
    const errors = [
      new NetworkError(),
      new TimeoutError("op"),
      new SimulationError(),
      new ContractCallError("fail"),
      new RPCResponseError(),
    ];
    const codes = errors.map((e) => e.code);
    expect(new Set(codes).size).toBe(errors.length);
  });
});

describe("NetworkError", () => {
  it("is retryable", () => {
    const err = new NetworkError("Connection refused", { url: "http://rpc" });
    expect(err.code).toBe("NETWORK_ERROR");
    expect(err.retryable).toBe(true);
  });
});

describe("TimeoutError", () => {
  it("is retryable", () => {
    const err = new TimeoutError("fetchInvoice", 5000);
    expect(err.code).toBe("TIMEOUT");
    expect(err.retryable).toBe(true);
    expect(err.context?.operation).toBe("fetchInvoice");
  });
});

describe("SimulationError", () => {
  it("is retryable", () => {
    const err = new SimulationError();
    expect(err.code).toBe("SIMULATION_FAILED");
    expect(err.retryable).toBe(true);
  });
});

describe("ContractCallError", () => {
  it("is non-retryable", () => {
    const err = new ContractCallError("Contract panicked", "CA...", "get_invoice");
    expect(err.code).toBe("CONTRACT_ERROR");
    expect(err.retryable).toBe(false);
    expect(err.contractId).toBe("CA...");
    expect(err.method).toBe("get_invoice");
  });
});

describe("RPCResponseError", () => {
  it("is non-retryable", () => {
    const err = new RPCResponseError();
    expect(err.code).toBe("RPC_RESPONSE_ERROR");
    expect(err.retryable).toBe(false);
  });
});

describe("isRetryableError", () => {
  it("retries ILNError with retryable=true", () => {
    expect(isRetryableError(new NetworkError())).toBe(true);
    expect(isRetryableError(new TimeoutError("op"))).toBe(true);
    expect(isRetryableError(new SimulationError())).toBe(true);
  });

  it("does not retry ILNError with retryable=false", () => {
    expect(isRetryableError(new ContractCallError("fail"))).toBe(false);
    expect(isRetryableError(new RPCResponseError())).toBe(false);
  });

  it("retries unknown non-ILN errors", () => {
    expect(isRetryableError(new Error("unexpected"))).toBe(true);
    expect(isRetryableError("string")).toBe(true);
    expect(isRetryableError(null)).toBe(true);
  });
});

describe("normalizeError", () => {
  it("returns ILNError unchanged", () => {
    const orig = new NetworkError("test");
    expect(normalizeError(orig)).toBe(orig);
  });

  it("wraps JS Error with timeout-like message into TimeoutError", () => {
    const err = new Error("Request timed out");
    err.name = "TimeoutError";
    const normalized = normalizeError(err);
    expect(normalized).toBeInstanceOf(TimeoutError);
    expect(normalized.retryable).toBe(true);
  });

  it("wraps fetch-like errors into NetworkError", () => {
    const err = new Error("fetch failed");
    err.name = "FetchError";
    const normalized = normalizeError(err);
    expect(normalized).toBeInstanceOf(NetworkError);
    expect(normalized.retryable).toBe(true);
  });

  it("wraps ECONNREFUSED errors into NetworkError", () => {
    const err = new Error("connect ECONNREFUSED 127.0.0.1:8080");
    const normalized = normalizeError(err);
    expect(normalized).toBeInstanceOf(NetworkError);
    expect(normalized.retryable).toBe(true);
  });

  it("wraps generic Error into ILNError", () => {
    const err = new Error("something broke");
    const normalized = normalizeError(err, "GENERIC", "Something went wrong");
    expect(normalized).toBeInstanceOf(ILNError);
    expect(normalized.code).toBe("GENERIC");
    expect(normalized.cause).toBe(err);
  });

  it("wraps string errors", () => {
    const normalized = normalizeError("bad input");
    expect(normalized).toBeInstanceOf(ILNError);
    expect(normalized.message).toBe("bad input");
  });

  it("wraps arbitrary objects", () => {
    const normalized = normalizeError({ status: 500 });
    expect(normalized).toBeInstanceOf(ILNError);
    expect(normalized.code).toBe("UNKNOWN_ERROR");
  });

  it("aliases toILNError", () => {
    expect(toILNError).toBe(normalizeError);
  });
});
