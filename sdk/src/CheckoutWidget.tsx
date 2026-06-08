import React, { useState } from "react";
import { ILNSdk } from "./client";
import { createFreighterSigner, ILN_TESTNET } from "./signers";
import type { ILNSdkConfig } from "./types";

export interface CheckoutWidgetProps {
  /** The invoice ID to fund (the checkout order). */
  orderId: bigint;
  /** Human-readable display amount (e.g. "100.00"). */
  amount: string;
  /** Token symbol shown to the user (e.g. "USDC"). */
  token: string;
  /** The merchant's Stellar address that submitted the invoice. */
  merchantAddress: string;
  /** Optional SDK config override (defaults to ILN testnet). */
  sdkConfig?: Partial<ILNSdkConfig>;
  onSuccess?: (orderId: bigint, funder: string) => void;
  onError?: (error: Error) => void;
}

type Status = "idle" | "connecting" | "submitting" | "success" | "error";

export function CheckoutWidget({
  orderId,
  amount,
  token,
  merchantAddress,
  sdkConfig,
  onSuccess,
  onError,
}: CheckoutWidgetProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handlePay() {
    setStatus("connecting");
    setErrorMsg(null);
    try {
      const signer = createFreighterSigner();
      const funder = await signer.getPublicKey();

      setStatus("submitting");

      const sdk = new ILNSdk({
        ...ILN_TESTNET,
        ...sdkConfig,
        signer,
      });

      await sdk.fundInvoice({ funder, invoiceId: orderId });

      setStatus("success");
      onSuccess?.(orderId, funder);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setStatus("error");
      setErrorMsg(error.message);
      onError?.(error);
    }
  }

  return (
    <div style={styles.container}>
      <p style={styles.summary}>
        Pay{" "}
        <strong>
          {amount} {token}
        </strong>{" "}
        to <code style={styles.address}>{merchantAddress.slice(0, 8)}…</code>
      </p>

      {status === "error" && (
        <p style={styles.error} role="alert">
          {errorMsg}
        </p>
      )}

      {status === "success" ? (
        <p style={styles.success}>Payment submitted ✓</p>
      ) : (
        <button
          style={styles.button}
          onClick={handlePay}
          disabled={status === "connecting" || status === "submitting"}
          aria-busy={status === "connecting" || status === "submitting"}
        >
          {status === "connecting"
            ? "Connecting wallet…"
            : status === "submitting"
              ? "Submitting…"
              : `Pay ${amount} ${token}`}
        </button>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    fontFamily: "sans-serif",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    padding: "1.25rem 1.5rem",
    maxWidth: 360,
    boxSizing: "border-box",
  },
  summary: { margin: "0 0 1rem", fontSize: 15 },
  address: { fontSize: 13, background: "#f1f5f9", padding: "1px 4px", borderRadius: 4 },
  button: {
    width: "100%",
    padding: "0.625rem 1rem",
    background: "#6366f1",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    fontSize: 15,
    cursor: "pointer",
  },
  success: { margin: 0, color: "#16a34a", fontWeight: 600 },
  error: { margin: "0 0 0.75rem", color: "#dc2626", fontSize: 13 },
};
