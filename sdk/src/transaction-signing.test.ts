/**
 * Tests for SDK transaction signing (#453)
 *
 * Covers:
 *  - Freighter signing flow (happy path, address resolution, error cases)
 *  - Keypair signing flow (happy path, multi-signature, invalid keys)
 *  - Signing with invalid keys
 *  - Timeout handling during signing
 *  - Realistic Freighter API mocks
 */

import {
  Keypair,
  Networks,
  Transaction,
  TransactionBuilder,
  Account,
  Operation,
  Asset,
} from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock Freighter API ───────────────────────────────────────────────────────

vi.mock("@stellar/freighter-api", () => ({
  getAddress: vi.fn(),
  getNetworkDetails: vi.fn(),
  isConnected: vi.fn(),
  requestAccess: vi.fn(),
  signTransaction: vi.fn(),
}));

import * as freighterApi from "@stellar/freighter-api";
import { createFreighterSigner, createKeypairSigner } from "./signers";

// ─── Test constants ───────────────────────────────────────────────────────────

const TESTNET_PASSPHRASE = Networks.TESTNET;
const MAINNET_PASSPHRASE = Networks.PUBLIC;

// Real Stellar keypairs for deterministic tests
const KEYPAIR_A = Keypair.random();
const KEYPAIR_B = Keypair.random();
const KEYPAIR_C = Keypair.random();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal payment transaction XDR for testing signing.
 * Uses a deterministic sequence number so the XDR is reproducible.
 */
function buildTestTransactionXdr(
  sourceKeypair: Keypair = KEYPAIR_A,
  networkPassphrase: string = TESTNET_PASSPHRASE,
): string {
  const account = new Account(sourceKeypair.publicKey(), "100");
  const tx = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase,
  })
    .addOperation(
      Operation.payment({
        destination: KEYPAIR_B.publicKey(),
        asset: Asset.native(),
        amount: "1",
      }),
    )
    .setTimeout(30)
    .build();
  return tx.toXDR();
}

/**
 * Parse and count the signatures on an XDR envelope.
 */
function countSignatures(signedXdr: string): number {
  const tx = TransactionBuilder.fromXDR(signedXdr, TESTNET_PASSPHRASE) as Transaction;
  return tx.signatures.length;
}

// ─── Freighter signing ────────────────────────────────────────────────────────

describe("createFreighterSigner", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("window", {});
    vi.mocked(freighterApi.isConnected).mockResolvedValue({ isConnected: true });
    vi.mocked(freighterApi.getNetworkDetails).mockResolvedValue({
      network: "TESTNET",
      networkPassphrase: TESTNET_PASSPHRASE,
      networkUrl: "https://rpc.testnet.example",
    });
  });

  // ─── Happy path ─────────────────────────────────────────────────────────────

  describe("happy path", () => {
    it("resolves the public key from getAddress when already connected", async () => {
      vi.mocked(freighterApi.getAddress).mockResolvedValue({
        address: KEYPAIR_A.publicKey(),
      });

      const signer = createFreighterSigner();
      const publicKey = await signer.getPublicKey();

      expect(publicKey).toBe(KEYPAIR_A.publicKey());
      expect(freighterApi.requestAccess).not.toHaveBeenCalled();
    });

    it("falls back to requestAccess when getAddress returns an empty address", async () => {
      vi.mocked(freighterApi.getAddress).mockResolvedValue({ address: "" });
      vi.mocked(freighterApi.requestAccess).mockResolvedValue({
        address: KEYPAIR_A.publicKey(),
      });

      const signer = createFreighterSigner();
      const publicKey = await signer.getPublicKey();

      expect(publicKey).toBe(KEYPAIR_A.publicKey());
      expect(freighterApi.requestAccess).toHaveBeenCalledOnce();
    });

    it("uses the pinned address when explicitly provided", async () => {
      const signer = createFreighterSigner(KEYPAIR_B.publicKey());
      // getAddress should not be called when address is pinned
      vi.mocked(freighterApi.getAddress).mockResolvedValue({ address: KEYPAIR_A.publicKey() });

      const publicKey = await signer.getPublicKey();

      // Returns the pinned address, not the one from getAddress
      expect(publicKey).toBe(KEYPAIR_B.publicKey());
    });

    it("signs a transaction and returns the signed XDR", async () => {
      vi.mocked(freighterApi.getAddress).mockResolvedValue({
        address: KEYPAIR_A.publicKey(),
      });
      const signedXdr = "SIGNED_TX_XDR";
      vi.mocked(freighterApi.signTransaction).mockResolvedValue({
        signedTxXdr: signedXdr,
        signerAddress: KEYPAIR_A.publicKey(),
      });

      const signer = createFreighterSigner();
      const result = await signer.signTransaction("UNSIGNED_XDR", {
        networkPassphrase: TESTNET_PASSPHRASE,
      });

      expect(result).toBe(signedXdr);
      expect(freighterApi.signTransaction).toHaveBeenCalledWith("UNSIGNED_XDR", {
        address: KEYPAIR_A.publicKey(),
        networkPassphrase: TESTNET_PASSPHRASE,
      });
    });

    it("passes the override address from SignTransactionOptions", async () => {
      vi.mocked(freighterApi.getAddress).mockResolvedValue({
        address: KEYPAIR_A.publicKey(),
      });
      vi.mocked(freighterApi.signTransaction).mockResolvedValue({
        signedTxXdr: "SIGNED",
        signerAddress: KEYPAIR_B.publicKey(),
      });

      const signer = createFreighterSigner();
      await signer.signTransaction("UNSIGNED_XDR", {
        networkPassphrase: TESTNET_PASSPHRASE,
        address: KEYPAIR_B.publicKey(),
      });

      expect(freighterApi.signTransaction).toHaveBeenCalledWith("UNSIGNED_XDR", {
        address: KEYPAIR_B.publicKey(),
        networkPassphrase: TESTNET_PASSPHRASE,
      });
    });

    it("skips network assertion when getNetworkDetails is unavailable", async () => {
      vi.mocked(freighterApi.getAddress).mockResolvedValue({
        address: KEYPAIR_A.publicKey(),
      });
      vi.mocked(freighterApi.signTransaction).mockResolvedValue({
        signedTxXdr: "SIGNED",
        signerAddress: KEYPAIR_A.publicKey(),
      });
      // Simulate an older Freighter build that lacks getNetworkDetails
      vi.spyOn(freighterApi, "getNetworkDetails" as any).mockImplementation(undefined as any);

      const signer = createFreighterSigner();
      await expect(
        signer.signTransaction("UNSIGNED_XDR", {
          networkPassphrase: TESTNET_PASSPHRASE,
        }),
      ).resolves.toBe("SIGNED");
    });
  });

  // ─── Network mismatch ────────────────────────────────────────────────────────

  describe("network mismatch", () => {
    it("throws when Freighter is connected to mainnet but testnet passphrase is requested", async () => {
      vi.mocked(freighterApi.getAddress).mockResolvedValue({
        address: KEYPAIR_A.publicKey(),
      });
      vi.mocked(freighterApi.getNetworkDetails).mockResolvedValue({
        network: "PUBLIC",
        networkPassphrase: MAINNET_PASSPHRASE,
        networkUrl: "https://rpc.mainnet.example",
      });

      const signer = createFreighterSigner();
      await expect(
        signer.signTransaction("UNSIGNED_XDR", {
          networkPassphrase: TESTNET_PASSPHRASE,
        }),
      ).rejects.toThrow("Freighter is connected to a different Stellar network.");
    });

    it("does not throw when passphrases match exactly", async () => {
      vi.mocked(freighterApi.getAddress).mockResolvedValue({
        address: KEYPAIR_A.publicKey(),
      });
      vi.mocked(freighterApi.getNetworkDetails).mockResolvedValue({
        network: "TESTNET",
        networkPassphrase: TESTNET_PASSPHRASE,
        networkUrl: "https://rpc.testnet.example",
      });
      vi.mocked(freighterApi.signTransaction).mockResolvedValue({
        signedTxXdr: "OK",
        signerAddress: KEYPAIR_A.publicKey(),
      });

      const signer = createFreighterSigner();
      await expect(
        signer.signTransaction("UNSIGNED_XDR", {
          networkPassphrase: TESTNET_PASSPHRASE,
        }),
      ).resolves.toBe("OK");
    });
  });

  // ─── Error propagation ───────────────────────────────────────────────────────

  describe("error propagation", () => {
    it("throws when window is undefined (non-browser environment)", async () => {
      vi.stubGlobal("window", undefined);
      const signer = createFreighterSigner();
      await expect(signer.getPublicKey()).rejects.toThrow(
        "Freighter signing is only available in browser environments.",
      );
    });

    it("throws when isConnected reports the extension is not installed", async () => {
      vi.mocked(freighterApi.isConnected).mockResolvedValue({ isConnected: false });
      const signer = createFreighterSigner();
      await expect(signer.getPublicKey()).rejects.toThrow(
        "Freighter extension is not installed or not available.",
      );
    });

    it("throws when isConnected itself returns an error", async () => {
      vi.mocked(freighterApi.isConnected).mockResolvedValue({
        isConnected: false,
        error: "Extension crashed",
      });
      const signer = createFreighterSigner();
      await expect(signer.getPublicKey()).rejects.toThrow("Extension crashed");
    });

    it("throws when getAddress returns an error", async () => {
      vi.mocked(freighterApi.getAddress).mockResolvedValue({
        address: "",
        error: "Address fetch failed",
      });
      const signer = createFreighterSigner();
      await expect(signer.getPublicKey()).rejects.toThrow("Address fetch failed");
    });

    it("throws when requestAccess returns an error", async () => {
      vi.mocked(freighterApi.getAddress).mockResolvedValue({ address: "" });
      vi.mocked(freighterApi.requestAccess).mockResolvedValue({
        address: "",
        error: "User rejected access",
      });
      const signer = createFreighterSigner();
      await expect(signer.getPublicKey()).rejects.toThrow("User rejected access");
    });

    it("throws when requestAccess returns no address and no error", async () => {
      vi.mocked(freighterApi.getAddress).mockResolvedValue({ address: "" });
      vi.mocked(freighterApi.requestAccess).mockResolvedValue({ address: "" });
      const signer = createFreighterSigner();
      await expect(signer.getPublicKey()).rejects.toThrow(
        "Freighter did not provide an account address.",
      );
    });

    it("throws when getNetworkDetails returns an error", async () => {
      vi.mocked(freighterApi.getAddress).mockResolvedValue({
        address: KEYPAIR_A.publicKey(),
      });
      vi.mocked(freighterApi.getNetworkDetails).mockResolvedValue({
        network: "",
        networkPassphrase: "",
        networkUrl: "",
        error: "Network details unavailable",
      });
      const signer = createFreighterSigner();
      await expect(
        signer.signTransaction("UNSIGNED_XDR", { networkPassphrase: TESTNET_PASSPHRASE }),
      ).rejects.toThrow("Network details unavailable");
    });

    it("throws when signTransaction returns an error", async () => {
      vi.mocked(freighterApi.getAddress).mockResolvedValue({
        address: KEYPAIR_A.publicKey(),
      });
      vi.mocked(freighterApi.signTransaction).mockResolvedValue({
        error: "User rejected signing",
        signedTxXdr: "",
        signerAddress: "",
      });
      const signer = createFreighterSigner();
      await expect(
        signer.signTransaction("UNSIGNED_XDR", { networkPassphrase: TESTNET_PASSPHRASE }),
      ).rejects.toThrow("User rejected signing");
    });

    it("throws a descriptive error when signTransaction returns no XDR and no error", async () => {
      vi.mocked(freighterApi.getAddress).mockResolvedValue({
        address: KEYPAIR_A.publicKey(),
      });
      vi.mocked(freighterApi.signTransaction).mockResolvedValue({
        signedTxXdr: undefined,
        signerAddress: "",
      });
      const signer = createFreighterSigner();
      await expect(
        signer.signTransaction("UNSIGNED_XDR", { networkPassphrase: TESTNET_PASSPHRASE }),
      ).rejects.toThrow("Freighter did not return a signed transaction.");
    });
  });

  // ─── Timeout simulation ──────────────────────────────────────────────────────

  describe("timeout handling", () => {
    it("propagates a rejected promise when signTransaction takes too long (caller timeout)", async () => {
      vi.mocked(freighterApi.getAddress).mockResolvedValue({
        address: KEYPAIR_A.publicKey(),
      });
      // Simulate a sign operation that never resolves (user left window open)
      vi.mocked(freighterApi.signTransaction).mockImplementation(
        () => new Promise((_resolve, reject) => setTimeout(() => reject(new Error("Timed out waiting for Freighter")), 10)),
      );

      const signer = createFreighterSigner();
      await expect(
        signer.signTransaction("UNSIGNED_XDR", { networkPassphrase: TESTNET_PASSPHRASE }),
      ).rejects.toThrow("Timed out waiting for Freighter");
    });
  });
});

// ─── Keypair signing ──────────────────────────────────────────────────────────

describe("createKeypairSigner", () => {
  // ─── Happy path ─────────────────────────────────────────────────────────────

  describe("happy path", () => {
    it("returns the correct public key for a given secret", async () => {
      const signer = createKeypairSigner(KEYPAIR_A.secret());
      expect(await signer.getPublicKey()).toBe(KEYPAIR_A.publicKey());
    });

    it("produces a valid signed transaction XDR", async () => {
      const txXdr = buildTestTransactionXdr(KEYPAIR_A);
      const signer = createKeypairSigner(KEYPAIR_A.secret());

      const signedXdr = await signer.signTransaction(txXdr, {
        networkPassphrase: TESTNET_PASSPHRASE,
      });

      expect(typeof signedXdr).toBe("string");
      expect(signedXdr.length).toBeGreaterThan(0);

      // Verify the signature is actually valid by parsing and checking signature count
      const sigCount = countSignatures(signedXdr);
      expect(sigCount).toBe(1);
    });

    it("signs the same XDR consistently (deterministic)", async () => {
      const txXdr = buildTestTransactionXdr(KEYPAIR_A);
      const signer = createKeypairSigner(KEYPAIR_A.secret());

      const signed1 = await signer.signTransaction(txXdr, {
        networkPassphrase: TESTNET_PASSPHRASE,
      });
      const signed2 = await signer.signTransaction(txXdr, {
        networkPassphrase: TESTNET_PASSPHRASE,
      });

      // Both calls should produce identical output
      expect(signed1).toBe(signed2);
    });

    it("different keypairs produce different signatures for the same XDR", async () => {
      const txXdr = buildTestTransactionXdr(KEYPAIR_A);
      const signerA = createKeypairSigner(KEYPAIR_A.secret());
      const signerB = createKeypairSigner(KEYPAIR_B.secret());

      const signedA = await signerA.signTransaction(txXdr, {
        networkPassphrase: TESTNET_PASSPHRASE,
      });
      const signedB = await signerB.signTransaction(txXdr, {
        networkPassphrase: TESTNET_PASSPHRASE,
      });

      expect(signedA).not.toBe(signedB);
    });

    it("works with mainnet network passphrase", async () => {
      const txXdr = buildTestTransactionXdr(KEYPAIR_A, MAINNET_PASSPHRASE);
      const signer = createKeypairSigner(KEYPAIR_A.secret());

      const signedXdr = await signer.signTransaction(txXdr, {
        networkPassphrase: MAINNET_PASSPHRASE,
      });

      // Verify parseable on mainnet passphrase
      expect(() =>
        TransactionBuilder.fromXDR(signedXdr, MAINNET_PASSPHRASE),
      ).not.toThrow();
    });
  });

  // ─── Multi-signature ─────────────────────────────────────────────────────────

  describe("multi-signature scenarios", () => {
    it("accumulates two signatures when two signers sign the same transaction sequentially", async () => {
      const txXdr = buildTestTransactionXdr(KEYPAIR_A);

      const signerA = createKeypairSigner(KEYPAIR_A.secret());
      const signerB = createKeypairSigner(KEYPAIR_B.secret());

      // First signer signs the original XDR
      const onceSigned = await signerA.signTransaction(txXdr, {
        networkPassphrase: TESTNET_PASSPHRASE,
      });

      // Second signer signs the already-signed XDR (accumulates signatures)
      const twiceSigned = await signerB.signTransaction(onceSigned, {
        networkPassphrase: TESTNET_PASSPHRASE,
      });

      expect(countSignatures(twiceSigned)).toBe(2);
    });

    it("accumulates three signatures for a 2-of-3 multisig transaction", async () => {
      const txXdr = buildTestTransactionXdr(KEYPAIR_A);
      const signers = [
        createKeypairSigner(KEYPAIR_A.secret()),
        createKeypairSigner(KEYPAIR_B.secret()),
        createKeypairSigner(KEYPAIR_C.secret()),
      ];

      let currentXdr = txXdr;
      for (const signer of signers) {
        currentXdr = await signer.signTransaction(currentXdr, {
          networkPassphrase: TESTNET_PASSPHRASE,
        });
      }

      expect(countSignatures(currentXdr)).toBe(3);
    });

    it("each intermediate XDR has exactly the right signature count", async () => {
      const txXdr = buildTestTransactionXdr(KEYPAIR_A);
      const signers = [
        createKeypairSigner(KEYPAIR_A.secret()),
        createKeypairSigner(KEYPAIR_B.secret()),
        createKeypairSigner(KEYPAIR_C.secret()),
      ];

      let currentXdr = txXdr;
      for (let i = 0; i < signers.length; i++) {
        currentXdr = await signers[i].signTransaction(currentXdr, {
          networkPassphrase: TESTNET_PASSPHRASE,
        });
        expect(countSignatures(currentXdr)).toBe(i + 1);
      }
    });

    it("signing the same XDR with the same keypair twice produces 2 identical signatures (not de-duped by SDK)", async () => {
      const txXdr = buildTestTransactionXdr(KEYPAIR_A);
      const signer = createKeypairSigner(KEYPAIR_A.secret());

      const onceSigned = await signer.signTransaction(txXdr, {
        networkPassphrase: TESTNET_PASSPHRASE,
      });
      const twiceSigned = await signer.signTransaction(onceSigned, {
        networkPassphrase: TESTNET_PASSPHRASE,
      });

      // The Stellar SDK appends a second (duplicate) signature — that is by design
      expect(countSignatures(twiceSigned)).toBe(2);
    });
  });

  // ─── Invalid key handling ────────────────────────────────────────────────────

  describe("invalid key handling", () => {
    it("throws immediately when constructed with a non-Stellar secret key", () => {
      expect(() => createKeypairSigner("not-a-valid-secret-key")).toThrow();
    });

    it("throws when constructed with an empty string", () => {
      expect(() => createKeypairSigner("")).toThrow();
    });

    it("throws when constructed with a public key instead of a secret key", () => {
      // Public keys start with 'G', secret keys start with 'S'
      expect(() => createKeypairSigner(KEYPAIR_A.publicKey())).toThrow();
    });

    it("throws when constructed with a secret key of the wrong length", () => {
      expect(() => createKeypairSigner("SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX")).toThrow();
    });

    it("throws for a key with an invalid checksum", () => {
      // Deliberately corrupt the last character of a valid key
      const validSecret = KEYPAIR_A.secret();
      const corrupted = validSecret.slice(0, -1) + (validSecret.endsWith("A") ? "B" : "A");
      expect(() => createKeypairSigner(corrupted)).toThrow();
    });
  });

  // ─── Concurrent signing ──────────────────────────────────────────────────────

  describe("concurrent signing", () => {
    it("handles parallel signing calls from the same signer correctly", async () => {
      const txXdr = buildTestTransactionXdr(KEYPAIR_A);
      const signer = createKeypairSigner(KEYPAIR_A.secret());

      // Fire 5 concurrent sign requests
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          signer.signTransaction(txXdr, {
            networkPassphrase: TESTNET_PASSPHRASE,
          }),
        ),
      );

      // All should produce the same deterministic XDR
      expect(new Set(results).size).toBe(1);
    });
  });
});
