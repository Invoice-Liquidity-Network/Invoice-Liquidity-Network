import { describe, it, expect } from "vitest";
import { generateBashCompletion, generateZshCompletion } from "../src/completion";
import { execSync } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("Shell Completion", () => {
  describe("generateBashCompletion", () => {
    it("should return a valid bash script", () => {
      const script = generateBashCompletion();

      expect(script).toContain("#!/usr/bin/env bash");
      expect(script).toContain("_iln_completions");
      expect(script).toContain("complete -F _iln_completions iln");
    });

    it("should include all commands", () => {
      const script = generateBashCompletion();

      expect(script).toContain("submit");
      expect(script).toContain("fund");
      expect(script).toContain("pay");
      expect(script).toContain("status");
      expect(script).toContain("list");
      expect(script).toContain("history");
      expect(script).toContain("config");
      expect(script).toContain("compat");
      expect(script).toContain("xdr");
      expect(script).toContain("dashboard");
      expect(script).toContain("dev");
    });

    it("should include submit options", () => {
      const script = generateBashCompletion();

      expect(script).toContain("--payer");
      expect(script).toContain("--amount");
      expect(script).toContain("--due");
      expect(script).toContain("--rate");
      expect(script).toContain("--token");
    });

    it("should include history options", () => {
      const script = generateBashCompletion();

      expect(script).toContain("--address");
      expect(script).toContain("--action");
      expect(script).toContain("--limit");
      expect(script).toContain("--format");
    });

    it("should include dev subcommands", () => {
      const script = generateBashCompletion();

      expect(script).toContain("start");
      expect(script).toContain("stop");
      expect(script).toContain("reset");
      expect(script).toContain("seed");
    });
  });

  describe("generateZshCompletion", () => {
    it("should return a valid zsh script", () => {
      const script = generateZshCompletion();

      expect(script).toContain("#compdef iln");
      expect(script).toContain("_iln()");
    });

    it("should include all commands with descriptions", () => {
      const script = generateZshCompletion();

      expect(script).toContain("submit:Submit a new invoice");
      expect(script).toContain("fund:Fund an invoice");
      expect(script).toContain("pay:Mark an invoice as paid");
      expect(script).toContain("status:Show invoice status");
      expect(script).toContain("list:List invoices by address");
      expect(script).toContain("history:Show invoice history");
      expect(script).toContain("config:Show protocol configuration");
      expect(script).toContain("compat:SDK and contract compatibility utilities");
      expect(script).toContain("xdr:Inspect Soroban XDR values");
      expect(script).toContain("dashboard:Launch real-time dashboard");
      expect(script).toContain("dev:Development utilities");
    });

    it("should include dev subcommands", () => {
      const script = generateZshCompletion();

      expect(script).toContain("start:Start local development environment");
      expect(script).toContain("stop:Stop local development environment");
      expect(script).toContain("reset:Reset local development environment");
      expect(script).toContain("status:Show local environment status");
      expect(script).toContain("seed:Create and fund testnet accounts");
    });

    it("should include history options with action choices", () => {
      const script = generateZshCompletion();

      expect(script).toContain("--action");
      expect(script).toContain("submit fund pay");
      expect(script).toContain("--format");
      expect(script).toContain("table json");
    });

    it("should include seed options with scenario choices", () => {
      const script = generateZshCompletion();

      expect(script).toContain("--scenario");
      expect(script).toContain("new-user active-lp disputed");
      expect(script).toContain("--token");
      expect(script).toContain("USDC EURC");
    });
  });

  describe("Syntax Validation", () => {
    it("bash completion script has valid syntax", () => {
      const script = generateBashCompletion();
      const tmpFile = join(tmpdir(), `iln-completion-bash-${Date.now()}.sh`);

      try {
        writeFileSync(tmpFile, script);

        // Validate bash syntax (bash -n checks syntax without executing)
        // If syntax is invalid, execSync will throw
        const result = execSync(`bash -n "${tmpFile}" 2>&1`, {
          encoding: "utf-8",
        });

        // No output from bash -n means syntax is valid
        expect(result.trim()).toBe("");
      } finally {
        try {
          unlinkSync(tmpFile);
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    it("zsh completion script has valid syntax", () => {
      const script = generateZshCompletion();
      const tmpFile = join(tmpdir(), `iln-completion-zsh-${Date.now()}.zsh`);

      try {
        writeFileSync(tmpFile, script);

        // Try to validate zsh syntax (zsh may not be available on CI)
        try {
          const result = execSync(`zsh -n "${tmpFile}" 2>&1`, {
            encoding: "utf-8",
          });

          // No output from zsh -n means syntax is valid
          expect(result.trim()).toBe("");
        } catch (error: any) {
          // If zsh is not installed, skip this check but log a warning
          if (
            error.message.includes("not found") ||
            error.status === 127
          ) {
            console.warn("zsh not available for syntax validation");
          } else {
            // Re-throw if it's a syntax error
            throw error;
          }
        }
      } finally {
        try {
          unlinkSync(tmpFile);
        } catch {
          // Ignore cleanup errors
        }
      }
    });
  });

  describe("Supported Shells", () => {
    it("completion command documents supported shells", () => {
      // This test verifies that the completion functionality supports
      // bash and zsh. If more shells are added, update this test and
      // the completion.ts file
      const bash = generateBashCompletion();
      const zsh = generateZshCompletion();

      expect(bash).toBeDefined();
      expect(zsh).toBeDefined();
      expect(bash.length).toBeGreaterThan(0);
      expect(zsh.length).toBeGreaterThan(0);
    });
  });
});
