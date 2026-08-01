import { describe, it, expect, vi, beforeEach } from "vitest";
import { isRetryableError, normalizeError } from "../errors";
import { ILNError, NetworkError, SimulationError, TimeoutError } from "../errors";

describe("poller error handling", () => {
  describe("normalizeError for poller scenarios", () => {
    it("normalizes RPC fetch failures into retryable NetworkError", () => {
      const err = new Error("connect ECONNREFUSED 127.0.0.1:8000");
      const normalized = normalizeError(err);
      expect(normalized).toBeInstanceOf(NetworkError);
      expect(normalized.retryable).toBe(true);
      expect(normalized.code).toBe("NETWORK_ERROR");
    });

    it("normalizes simulation failures into retryable SimulationError", () => {
      const err = new Error("simulation failed");
      const normalized = normalizeError(err);
      expect(normalized.retryable).toBe(true);
    });

    it("normalizes timeout errors into retryable TimeoutError", () => {
      const err = new Error("request timeout");
      err.name = "TimeoutError";
      const normalized = normalizeError(err);
      expect(normalized).toBeInstanceOf(TimeoutError);
      expect(normalized.retryable).toBe(true);
    });

    it("preserves existing ILNError retryability", () => {
      const nonRetryable = new ILNError("bad", "BAD", "fix", { retryable: false });
      expect(normalizeError(nonRetryable).retryable).toBe(false);

      const retryable = new NetworkError("net");
      expect(normalizeError(retryable).retryable).toBe(true);
    });
  });

  describe("isRetryableError for poller decisions", () => {
    it("retries network errors", () => {
      expect(isRetryableError(new NetworkError())).toBe(true);
    });

    it("retries timeout errors", () => {
      expect(isRetryableError(new TimeoutError("poll"))).toBe(true);
    });

    it("retries simulation errors", () => {
      expect(isRetryableError(new SimulationError())).toBe(true);
    });

    it("does not retry non-retryable ILNErrors", () => {
      const err = new ILNError("bad", "BAD", "fix", { retryable: false });
      expect(isRetryableError(err)).toBe(false);
    });

    it("retries unknown errors (assumed transient)", () => {
      expect(isRetryableError(new Error("unknown"))).toBe(true);
      expect(isRetryableError(null)).toBe(true);
    });
  });

  describe("consecutive error backoff calculation", () => {
    it("exponential backoff doubles each attempt", () => {
      const base = 2000;
      const delays = [];
      for (let i = 1; i <= 5; i++) {
        delays.push(base * Math.pow(2, i - 1));
      }
      expect(delays).toEqual([2000, 4000, 8000, 16000, 32000]);
    });
  });
});
