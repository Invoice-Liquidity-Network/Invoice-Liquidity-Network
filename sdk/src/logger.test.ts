import { describe, it, expect, vi, beforeEach } from "vitest";
import { createLogger, LogLevel, setLogLevel, addTransport } from "./logger";

describe("Logger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setLogLevel(LogLevel.DEBUG);
  });

  it("should log at different levels", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createLogger("test");

    logger.debug("debug message");
    logger.info("info message");
    logger.warn("warn message");

    expect(consoleSpy).toHaveBeenCalledTimes(3);
    const output = consoleSpy.mock.calls.map(c => c[0]).join(" ");
    expect(output).toContain("DEBUG");
    expect(output).toContain("INFO");
    expect(output).toContain("WARN");
  });

  it("should respect log levels", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    setLogLevel(LogLevel.WARN);
    const logger = createLogger("test");

    logger.debug("should not show");
    logger.info("should not show");
    logger.warn("should show");

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy.mock.calls[0][0]).toContain("WARN");
  });

  it("should support custom transports", () => {
    const transport = vi.fn();
    addTransport(transport);
    const logger = createLogger("test");

    logger.info("hello transport", { foo: "bar" });

    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      level: "INFO",
      message: "hello transport",
      data: { foo: "bar" },
      namespace: "test"
    }));
  });

  it("should measure execution time", async () => {
    const logger = createLogger("test");
    const result = await logger.measure("task", async () => {
      await new Promise(r => setTimeout(r, 10));
      return "done";
    });

    expect(result).toBe("done");
  });

  it("should be callable as a function (backward compatibility)", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createLogger("test");

    logger("classic message");

    expect(consoleSpy).toHaveBeenCalled();
    expect(consoleSpy.mock.calls[0][0]).toContain("DEBUG");
    expect(consoleSpy.mock.calls[0][0]).toContain("classic message");
  });
});
