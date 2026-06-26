// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { OfflineQueuePanel } from "../OfflineQueuePanel";
import { OfflineManager, createMemoryOfflineStorage } from "../offline";

function createManager() {
  return new OfflineManager({
    storage: createMemoryOfflineStorage(),
    storageKey: "offline_queue_panel_test",
    maxRetries: 1,
  });
}

function render(ui: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;

  act(() => {
    root = createRoot(container);
    root.render(ui);
  });

  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function expectText(container: HTMLElement, text: string) {
  expect(container.textContent).toContain(text);
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (element) => element.textContent === text,
  );

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button "${text}" not found`);
  }

  return button;
}

describe("OfflineQueuePanel", () => {
  it("renders empty queue status", () => {
    const manager = createManager();
    const view = render(<OfflineQueuePanel manager={manager} />);

    expectText(view.container, "Offline Queue");
    expectText(view.container, "No queued transactions");
    expectText(view.container, "Queue is clear");

    view.unmount();
    manager.destroy();
  });

  it("renders queued transactions and clears them", async () => {
    const manager = createManager();
    const view = render(<OfflineQueuePanel manager={manager} />);

    act(() => {
      manager.enqueue("submitInvoice", { amount: 1000n });
    });

    expectText(view.container, "Submit Invoice");
    expectText(view.container, "1 queued transaction");

    await act(async () => {
      buttonByText(view.container, "Clear").click();
    });

    expectText(view.container, "Queue is clear");
    view.unmount();
    manager.destroy();
  });

  it("removes a single queued transaction", async () => {
    const manager = createManager();
    const view = render(<OfflineQueuePanel manager={manager} />);

    act(() => {
      manager.enqueue("fundInvoice", { invoiceId: 1n });
    });

    expectText(view.container, "Fund Invoice");

    await act(async () => {
      buttonByText(view.container, "Remove").click();
    });

    expectText(view.container, "No queued transactions");
    view.unmount();
    manager.destroy();
  });
});
