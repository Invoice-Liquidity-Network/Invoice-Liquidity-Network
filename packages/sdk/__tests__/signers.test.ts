import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@stellar/freighter-api", () => ({
  getAddress: vi.fn(),
  getNetworkDetails: vi.fn(),
  isConnected: vi.fn(),
  requestAccess: vi.fn(),
  signTransaction: vi.fn(),
}));

import * as freighterApi from "@stellar/freighter-api";

import { createFreighterSigner } from "../src/signers";

describe("createFreighterSigner", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {});
    vi.mocked(freighterApi.isConnected).mockResolvedValue({ isConnected: true });
    vi.mocked(freighterApi.getNetworkDetails).mockResolvedValue({
      network: "TESTNET",
      networkPassphrase: "Test SDF Network ; September 2015",
      networkUrl: "https://rpc.example.test",
    });
  });

  it("uses Freighter to resolve the account and sign transactions", async () => {
    vi.mocked(freighterApi.getAddress).mockResolvedValue({ address: "" });
    vi.mocked(freighterApi.requestAccess).mockResolvedValue({
      address: "GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12",
    });
    vi.mocked(freighterApi.signTransaction).mockResolvedValue({
      signerAddress: "GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12",
      signedTxXdr: "signed-xdr",
    });

    const signer = createFreighterSigner();
    const address = await signer.getPublicKey();
    const signed = await signer.signTransaction("unsigned-xdr", {
      networkPassphrase: "Test SDF Network ; September 2015",
    });

    expect(address).toBe("GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12");
    expect(signed).toBe("signed-xdr");
    expect(freighterApi.signTransaction).toHaveBeenCalledWith("unsigned-xdr", {
      address: "GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12",
      networkPassphrase: "Test SDF Network ; September 2015",
    });
  });

  it("throws when Freighter is connected to the wrong network", async () => {
    vi.mocked(freighterApi.getAddress).mockResolvedValue({
      address: "GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12",
    });
    vi.mocked(freighterApi.getNetworkDetails).mockResolvedValue({
      network: "PUBLIC",
      networkPassphrase: "Public Global Stellar Network ; September 2015",
      networkUrl: "https://rpc.example.public",
    });

    const signer = createFreighterSigner();

    await expect(
      signer.signTransaction("unsigned-xdr", {
        networkPassphrase: "Test SDF Network ; September 2015",
      }),
    ).rejects.toThrow(
      "Freighter is connected to a different Stellar network.",
    );
  });
  it("throws when Freighter is not installed", async () => {
    vi.mocked(freighterApi.isConnected).mockResolvedValue({ isConnected: false });
    const signer = createFreighterSigner();
    await expect(signer.getPublicKey()).rejects.toThrow("Freighter extension is not installed or not available.");
  });

  it("throws when Freighter returns an error on connection check", async () => {
    vi.mocked(freighterApi.isConnected).mockResolvedValue({
      error: "Connection error",
      isConnected: false,
    });
    const signer = createFreighterSigner();
    await expect(signer.getPublicKey()).rejects.toThrow("Connection error");
  });

  it("throws when window is undefined", async () => {
    vi.stubGlobal("window", undefined);
    const signer = createFreighterSigner();
    await expect(signer.getPublicKey()).rejects.toThrow("Freighter signing is only available in browser environments.");
  });

  it("throws when getAddress returns an error", async () => {
    vi.mocked(freighterApi.getAddress).mockResolvedValue({
      address: "",
      error: "Address error",
    });
    const signer = createFreighterSigner();
    await expect(signer.getPublicKey()).rejects.toThrow("Address error");
  });

  it("throws when requestAccess returns an error", async () => {
    vi.mocked(freighterApi.getAddress).mockResolvedValue({ address: "" });
    vi.mocked(freighterApi.requestAccess).mockResolvedValue({
      address: "",
      error: "Request error",
    });
    const signer = createFreighterSigner();
    await expect(signer.getPublicKey()).rejects.toThrow("Request error");
  });

  it("throws when getNetworkDetails returns an error", async () => {
    vi.mocked(freighterApi.getAddress).mockResolvedValue({ address: "G123" });
    vi.mocked(freighterApi.getNetworkDetails).mockResolvedValue({
      error: "Network error",
      network: "",
      networkPassphrase: "",
      networkUrl: "",
    });
    const signer = createFreighterSigner();
    await expect(signer.signTransaction("unsigned-xdr", { networkPassphrase: "Test SDF Network ; September 2015" })).rejects.toThrow("Network error");
  });

  it("throws when signTransaction returns an error", async () => {
    vi.mocked(freighterApi.getAddress).mockResolvedValue({ address: "G123" });
    vi.mocked(freighterApi.signTransaction).mockResolvedValue({
      error: "Sign error",
      signedTxXdr: "",
      signerAddress: "",
    });
    const signer = createFreighterSigner();
    await expect(signer.signTransaction("unsigned-xdr", { networkPassphrase: "Test SDF Network ; September 2015" })).rejects.toThrow("Sign error");
  });
});
