import React from "react";
import ReactDOM from "react-dom/client";
import { CheckoutWidget, CheckoutWidgetProps } from "../components/CheckoutWidget";

/**
 * Custom element <iln-checkout-widget> to embed the CheckoutWidget.
 * Attributes:
 *  - order-id (required, bigint string)
 *  - amount (required, string)
 *  - token (required, string)
 *  - merchant-address (required, string)
 *  - config (optional, JSON string for SDK config)
 */
class ILNCheckoutWidget extends HTMLElement {
  private root: ShadowRoot;
  private container: HTMLDivElement | null = null;

  static get observedAttributes() {
    return ["order-id", "amount", "token", "merchant-address", "config"]; 
  }

  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  private render() {
    // Ensure container exists
    if (!this.container) {
      this.container = document.createElement("div");
      this.root.appendChild(this.container);
    }
    const props: CheckoutWidgetProps = {
      orderId: BigInt(this.getAttribute("order-id") || "0"),
      amount: this.getAttribute("amount") || "",
      token: this.getAttribute("token") || "",
      merchantAddress: this.getAttribute("merchant-address") || "",
      sdkConfig: this.parseConfig(this.getAttribute("config")),
    };
    const reactRoot = ReactDOM.createRoot(this.container);
    reactRoot.render(React.createElement(CheckoutWidget, props));
  }

  private parseConfig(configStr: string | null): Partial<any> | undefined {
    if (!configStr) return undefined;
    try {
      return JSON.parse(configStr);
    } catch {
      console.warn("Invalid JSON in config attribute for iln-checkout-widget");
      return undefined;
    }
  }
}

customElements.define("iln-checkout-widget", ILNCheckoutWidget);
