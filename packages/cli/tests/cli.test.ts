import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { registerCommands } from "../src/commands";
import * as configModule from "../src/config";
import { ILNSdk, AnalyticsSDK } from "@iln/sdk";

// Mock the SDK
vi.mock("@iln/sdk", () => {
  return {
    ILNSdk: vi.fn().mockImplementation(() => ({
      submitInvoice: vi.fn(),
      fundInvoice: vi.fn(),
      markPaid: vi.fn(),
      getInvoice: vi.fn(),
      getInvoiceCount: vi.fn(),
      getReputation: vi.fn(),
    })),
    AnalyticsSDK: vi.fn().mockImplementation(() => ({
      getProtocolStats: vi.fn(),
    })),
    createKeypairSigner: vi.fn(),
  };
});

describe("CLI Commands", () => {
  let program: Command;
  let consoleLogMock: any;
  let consoleErrorMock: any;
  let processExitMock: any;

  beforeEach(() => {
    vi.restoreMocks();
    program = new Command();
    program.option("--json", "output JSON");
    registerCommands(program);

    // Mock console and process
    consoleLogMock = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorMock = vi.spyOn(console, "error").mockImplementation(() => {});
    processExitMock = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    consoleLogMock.mockRestore();
    consoleErrorMock.mockRestore();
    processExitMock.mockRestore();
  });

  describe("Config Loading", () => {
    it("submits command and resolves signer address from loaded config", async () => {
      vi.spyOn(configModule, "loadConfig").mockReturnValue({
        network: "testnet",
        contractId: "C123",
        secretKey: "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        rpcUrl: "http://test",
        networkPassphrase: "testnet-passphrase",
      });

      const mockSubmit = vi.fn().mockResolvedValue(42n);
      // @ts-ignore
      ILNSdk.mockImplementation(() => ({
        submitInvoice: mockSubmit,
      }));

      await program.parseAsync([
        "node",
        "iln",
        "invoice",
        "submit",
        "--payer",
        "Gpayer123",
        "--amount",
        "100",
        "--due-date",
        "2026-06-02",
        "--discount-rate",
        "300",
      ]);

      expect(mockSubmit).toHaveBeenCalled();
      expect(consoleLogMock).toHaveBeenCalledWith(expect.stringContaining("submitted"));
    });

    it("handles missing contract ID gracefully", async () => {
      vi.spyOn(configModule, "loadConfig").mockReturnValue({
        network: "testnet",
      });

      await expect(
        program.parseAsync([
          "node",
          "iln",
          "invoice",
          "submit",
          "--payer",
          "Gpayer",
          "--amount",
          "10",
          "--due-date",
          "2026-06-02",
          "--discount-rate",
          "300",
        ])
      ).rejects.toThrow("process.exit(1)");

      expect(consoleErrorMock).toHaveBeenCalledWith(
        expect.stringContaining("Missing contract ID")
      );
    });
  });

  describe("Invoice Subcommands", () => {
    it("funds an invoice successfully", async () => {
      vi.spyOn(configModule, "loadConfig").mockReturnValue({
        network: "testnet",
        contractId: "C123",
        secretKey: "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      });

      const mockFund = vi.fn().mockResolvedValue(undefined);
      // @ts-ignore
      ILNSdk.mockImplementation(() => ({
        fundInvoice: mockFund,
      }));

      await program.parseAsync([
        "node",
        "iln",
        "invoice",
        "fund",
        "--id",
        "5",
      ]);

      expect(mockFund).toHaveBeenCalledWith({
        funder: expect.any(String),
        invoiceId: 5n,
      });
      expect(consoleLogMock).toHaveBeenCalledWith(expect.stringContaining("funded"));
    });

    it("marks invoice as paid successfully", async () => {
      vi.spyOn(configModule, "loadConfig").mockReturnValue({
        network: "testnet",
        contractId: "C123",
        secretKey: "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      });

      const mockPay = vi.fn().mockResolvedValue(undefined);
      // @ts-ignore
      ILNSdk.mockImplementation(() => ({
        markPaid: mockPay,
      }));

      await program.parseAsync([
        "node",
        "iln",
        "invoice",
        "pay",
        "--id",
        "9",
      ]);

      expect(mockPay).toHaveBeenCalledWith({
        invoiceId: 9n,
      });
      expect(consoleLogMock).toHaveBeenCalledWith(expect.stringContaining("paid"));
    });

    it("gets invoice and outputs table format", async () => {
      vi.spyOn(configModule, "loadConfig").mockReturnValue({
        network: "testnet",
        contractId: "C123",
      });

      const mockGet = vi.fn().mockResolvedValue({
        id: 7n,
        freelancer: "Gfree",
        payer: "Gpayer",
        amount: 50000000n,
        dueDate: 1700000000,
        discountRate: 300,
        status: "Funded",
        funder: "Gfund",
        fundedAt: 1600000000,
      });
      // @ts-ignore
      ILNSdk.mockImplementation(() => ({
        getInvoice: mockGet,
      }));

      await program.parseAsync([
        "node",
        "iln",
        "invoice",
        "get",
        "7",
      ]);

      expect(mockGet).toHaveBeenCalledWith(7n);
      expect(consoleLogMock).toHaveBeenCalled();
    });

    it("lists all invoices and filters by address", async () => {
      vi.spyOn(configModule, "loadConfig").mockReturnValue({
        network: "testnet",
        contractId: "C123",
      });

      const mockCount = vi.fn().mockResolvedValue(2n);
      const mockGet = vi.fn().mockImplementation(async (id: bigint) => {
        if (id === 1n) {
          return {
            id: 1n,
            freelancer: "Gtarget",
            payer: "Gpayer",
            amount: 1000n,
            dueDate: 123,
            discountRate: 5,
            status: "Pending",
          };
        }
        return {
          id: 2n,
          freelancer: "Gother",
          payer: "Gpayer",
          amount: 2000n,
          dueDate: 124,
          discountRate: 6,
          status: "Pending",
        };
      });

      // @ts-ignore
      ILNSdk.mockImplementation(() => ({
        getInvoiceCount: mockCount,
        getInvoice: mockGet,
      }));

      await program.parseAsync([
        "node",
        "iln",
        "invoice",
        "list",
        "--address",
        "Gtarget",
      ]);

      expect(mockCount).toHaveBeenCalled();
      expect(mockGet).toHaveBeenCalledTimes(2);
      expect(consoleLogMock).toHaveBeenCalled();
    });
  });

  describe("Stats and Reputation Subcommands", () => {
    it("fetches protocol stats and outputs them", async () => {
      vi.spyOn(configModule, "loadConfig").mockReturnValue({
        network: "testnet",
      });

      const mockStats = vi.fn().mockResolvedValue({
        totalInvoices: 10,
        totalVolume: 100000000n,
        totalYield: 5000000n,
        defaultRate: 0.1,
      });
      // @ts-ignore
      AnalyticsSDK.mockImplementation(() => ({
        getProtocolStats: mockStats,
      }));

      await program.parseAsync([
        "node",
        "iln",
        "stats",
      ]);

      expect(mockStats).toHaveBeenCalled();
      expect(consoleLogMock).toHaveBeenCalled();
    });

    it("fetches reputation for an address", async () => {
      vi.spyOn(configModule, "loadConfig").mockReturnValue({
        network: "testnet",
        contractId: "C123",
      });

      const mockRep = vi.fn().mockResolvedValue(4);
      // @ts-ignore
      ILNSdk.mockImplementation(() => ({
        getReputation: mockRep,
      }));

      await program.parseAsync([
        "node",
        "iln",
        "reputation",
        "get",
        "Gaddress",
      ]);

      expect(mockRep).toHaveBeenCalledWith("Gaddress");
      expect(consoleLogMock).toHaveBeenCalledWith(expect.stringContaining("Reputation Score: 4"));
    });
  });

  describe("Network Subcommands", () => {
    it("switches network and calls saveConfig", async () => {
      const mockSave = vi.spyOn(configModule, "saveConfig").mockImplementation(() => {});

      await program.parseAsync([
        "node",
        "iln",
        "network",
        "switch",
        "mainnet",
      ]);

      expect(mockSave).toHaveBeenCalledWith({ network: "mainnet" });
      expect(consoleLogMock).toHaveBeenCalledWith(expect.stringContaining("switched to mainnet"));
    });
  });

  describe("JSON Output Mode", () => {
    it("returns JSON formatted output when global flag is active", async () => {
      vi.spyOn(configModule, "loadConfig").mockReturnValue({
        network: "testnet",
        contractId: "C123",
      });

      const mockRep = vi.fn().mockResolvedValue(8);
      // @ts-ignore
      ILNSdk.mockImplementation(() => ({
        getReputation: mockRep,
      }));

      await program.parseAsync([
        "node",
        "iln",
        "--json",
        "reputation",
        "get",
        "Gaddress",
      ]);

      expect(consoleLogMock).toHaveBeenCalledWith(
        JSON.stringify({ address: "Gaddress", score: 8 }, null, 2)
      );
    });
  });

  describe("SDK Failure Paths", () => {
    it("prints actionable errors on SDK exception", async () => {
      vi.spyOn(configModule, "loadConfig").mockReturnValue({
        network: "testnet",
        contractId: "C123",
      });

      // @ts-ignore
      ILNSdk.mockImplementation(() => ({
        getInvoice: vi.fn().mockRejectedValue(new Error("RPC Connection Refused")),
      }));

      await expect(
        program.parseAsync([
          "node",
          "iln",
          "invoice",
          "get",
          "1",
        ])
      ).rejects.toThrow("process.exit(1)");

      expect(consoleErrorMock).toHaveBeenCalledWith(expect.stringContaining("RPC Connection Refused"));
    });
  });
});
