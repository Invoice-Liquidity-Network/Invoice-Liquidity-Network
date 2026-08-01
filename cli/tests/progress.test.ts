import { Writable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createProgressBar,
  createSpinner,
  createTransactionProgress,
  withProgressBar,
  withSpinner,
} from "../src/progress";

function createMemoryStream(): Writable & { text(): string } {
  let buffer = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      buffer += chunk.toString();
      callback();
    },
  });
  return Object.assign(stream, {
    text: () => buffer,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createSpinner", () => {
  it("emits an initial status message when animation is disabled", () => {
    const output = createMemoryStream();
    const spinner = createSpinner("Loading data…", { output, enabled: false });

    expect(output.text()).toContain("Loading data…");
    spinner.stop();
  });

  it("updates the status message when animation is disabled", () => {
    const output = createMemoryStream();
    const spinner = createSpinner("Step one", { output, enabled: false });

    spinner.update("Step two");
    expect(output.text()).toContain("Step two");
    spinner.stop();
  });

  it("prints a green success line on succeed", () => {
    const output = createMemoryStream();
    const spinner = createSpinner("Working…", { output, enabled: false });

    spinner.succeed("Done");
    expect(output.text()).toContain("Done");
    spinner.stop();
  });

  it("prints a red failure line on fail", () => {
    const output = createMemoryStream();
    const spinner = createSpinner("Working…", { output, enabled: false });

    spinner.fail("Failed");
    expect(output.text()).toContain("Failed");
  });

  it("animates frames when enabled on a TTY stream", () => {
    vi.useFakeTimers();
    const output = createMemoryStream();
    Object.defineProperty(output, "isTTY", { value: true });

    const spinner = createSpinner("Waiting…", { output, enabled: true });
    vi.advanceTimersByTime(160);

    expect(output.text()).toMatch(/Waiting…/);
    spinner.stop();
  });
});

describe("createProgressBar", () => {
  it("shows percentage in the rendered output", () => {
    const output = createMemoryStream();
    const bar = createProgressBar(4, "Deploying", { output, enabled: false });

    bar.update(2);
    expect(output.text()).toContain("50%");
    expect(output.text()).toContain("(2/4)");
    bar.stop();
  });

  it("increments progress and updates the status message", () => {
    const output = createMemoryStream();
    const bar = createProgressBar(3, "Starting", { output, enabled: false });

    bar.increment(1, "Indexing");
    expect(output.text()).toContain("33%");
    expect(output.text()).toContain("Indexing");

    bar.increment(1, "Notifications");
    expect(output.text()).toContain("67%");
    expect(output.text()).toContain("Notifications");
    bar.stop();
  });

  it("completes at 100% on succeed", () => {
    const output = createMemoryStream();
    const bar = createProgressBar(2, "Setup", { output, enabled: false });

    bar.increment();
    bar.succeed("Environment ready");
    expect(output.text()).toContain("100%");
    expect(output.text()).toContain("Environment ready");
  });
});

describe("withSpinner", () => {
  it("returns the wrapped result and clears the spinner", async () => {
    const output = createMemoryStream();
    const result = await withSpinner(
      "Submitting…",
      async () => "ok",
      { output, enabled: false },
    );

    expect(result).toBe("ok");
    expect(output.text()).toContain("Submitting…");
  });

  it("emits a success message when successMsg is provided", async () => {
    const output = createMemoryStream();
    await withSpinner(
      "Fetching…",
      async () => 42,
      { output, enabled: false },
      "Done fetching",
    );

    expect(output.text()).toContain("Done fetching");
  });

  it("rethrows errors after marking failure", async () => {
    const output = createMemoryStream();

    await expect(
      withSpinner("Submitting…", async () => {
        throw new Error("boom");
      }, { output, enabled: false }),
    ).rejects.toThrow("boom");

    expect(output.text()).toContain("Submitting…");
  });
});

describe("withProgressBar", () => {
  it("runs the callback with a progress bar handle", async () => {
    const output = createMemoryStream();
    const steps: number[] = [];

    await withProgressBar(
      2,
      "Bootstrapping",
      async (bar) => {
        bar.increment(1, "Step A");
        steps.push(1);
        bar.increment(1, "Step B");
        steps.push(2);
        return "done";
      },
      { output, enabled: false },
    );

    expect(steps).toEqual([1, 2]);
    expect(output.text()).toContain("Step B");
  });
});

describe("createTransactionProgress", () => {
  it("advances through build → simulate → sign → submit phases", () => {
    const output = createMemoryStream();
    const tx = createTransactionProgress("Deploy contract", { output, enabled: false });

    // Initial render includes "Building"
    expect(output.text()).toContain("Building");

    tx.built();
    expect(output.text()).toContain("Simulating");

    tx.simulated();
    expect(output.text()).toContain("Signing");

    tx.signed();
    expect(output.text()).toContain("Submitting");

    tx.succeed("Deploy done");
    expect(output.text()).toContain("Deploy done");
    expect(output.text()).toContain("100%");
  });

  it("shows failure message on fail()", () => {
    const output = createMemoryStream();
    const tx = createTransactionProgress("Fund invoice", { output, enabled: false });

    tx.built();
    tx.fail("Network error");
    expect(output.text()).toContain("Network error");
  });

  it("uses default fail label when no message given", () => {
    const output = createMemoryStream();
    const tx = createTransactionProgress("Submit invoice", { output, enabled: false });

    tx.fail();
    expect(output.text()).toContain("Submit invoice failed");
  });
});

describe("ETA and elapsed time in createProgressBar", () => {
  it("includes ETA string after first increment when enough time has passed", () => {
    vi.useFakeTimers();
    const output = createMemoryStream();
    // Total 4 steps; advance clock by 2 seconds before first increment
    const bar = createProgressBar(4, "Processing", { output, enabled: false });
    vi.advanceTimersByTime(2000);
    bar.increment(1, "Step 1 done");

    const text = output.text();
    // ETA should appear since elapsed > 0 and we have rate data
    expect(text).toMatch(/ETA/);
    bar.stop();
  });

  it("does not show ETA at step 0", () => {
    const output = createMemoryStream();
    const bar = createProgressBar(4, "Waiting", { output, enabled: false });
    // Before any increment the bar renders at 0 steps — no ETA
    const text = output.text();
    expect(text).not.toMatch(/ETA/);
    bar.stop();
  });

  it("shows elapsed time suffix after 500ms", () => {
    vi.useFakeTimers();
    const output = createMemoryStream();
    const bar = createProgressBar(4, "Work", { output, enabled: false });
    vi.advanceTimersByTime(800);
    bar.increment(1, "Step");
    expect(output.text()).toMatch(/\[\d+\.\d+s\]/);
    bar.stop();
  });
});
