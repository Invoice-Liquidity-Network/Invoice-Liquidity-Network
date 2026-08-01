import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { AnalyticsPluginLoader, type AnalyticsPlugin, type AnalyticsPluginContext, type WidgetRenderResult } from "../plugins";
import { BUILTIN_ANALYTICS_PLUGINS } from "./builtins";

describe("Built-in Analytics Plugins", () => {
  let loader: AnalyticsPluginLoader;

  beforeAll(() => {
    loader = new AnalyticsPluginLoader("http://localhost:3001");
  });

  afterAll(() => {});

  it("exports exactly 4 built-in plugins", () => {
    expect(BUILTIN_ANALYTICS_PLUGINS).toHaveLength(4);
  });

  it("all plugins pass validation", async () => {
    for (const plugin of BUILTIN_ANALYTICS_PLUGINS) {
      const result = await loader.load(plugin);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      await loader.unload(plugin.id);
    }
  });

  it("each plugin has unique id", () => {
    const ids = BUILTIN_ANALYTICS_PLUGINS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("each plugin has at least one metric and one widget", () => {
    for (const plugin of BUILTIN_ANALYTICS_PLUGINS) {
      expect(plugin.metrics.length).toBeGreaterThan(0);
      expect(plugin.widgets.length).toBeGreaterThan(0);
    }
  });

  it("all widgets have valid sizes", () => {
    const validSizes = ["small", "medium", "large", "full"];
    for (const plugin of BUILTIN_ANALYTICS_PLUGINS) {
      for (const widget of plugin.widgets) {
        expect(validSizes).toContain(widget.size);
      }
    }
  });

  it("all metrics have valid types", () => {
    const validTypes = ["number", "percentage", "duration", "currency", "ratio"];
    for (const plugin of BUILTIN_ANALYTICS_PLUGINS) {
      for (const metric of plugin.metrics) {
        expect(validTypes).toContain(metric.type);
      }
    }
  });

  it("all plugins have semver versions", () => {
    for (const plugin of BUILTIN_ANALYTICS_PLUGINS) {
      expect(plugin.version).toMatch(/^\d+\.\d+\.\d+/);
    }
  });
});

describe("AnalyticsPluginLoader", () => {
  let loader: AnalyticsPluginLoader;

  beforeAll(() => {
    loader = new AnalyticsPluginLoader("http://localhost:3001");
  });

  afterAll(async () => {
    for (const p of loader.getPlugins()) {
      await loader.unload(p.id);
    }
  });

  it("starts with no plugins loaded", () => {
    expect(loader.getPlugins()).toHaveLength(0);
  });

  it("loads a plugin successfully", async () => {
    const result = await loader.load(BUILTIN_ANALYTICS_PLUGINS[0]);
    expect(result.valid).toBe(true);
    expect(loader.isLoaded(BUILTIN_ANALYTICS_PLUGINS[0].id)).toBe(true);
    await loader.unload(BUILTIN_ANALYTICS_PLUGINS[0].id);
  });

  it("rejects loading the same plugin twice", async () => {
    await loader.load(BUILTIN_ANALYTICS_PLUGINS[0]);
    const result = await loader.load(BUILTIN_ANALYTICS_PLUGINS[0]);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(`Plugin "${BUILTIN_ANALYTICS_PLUGINS[0].id}" is already loaded`);
    await loader.unload(BUILTIN_ANALYTICS_PLUGINS[0].id);
  });

  it("lists loaded plugins", async () => {
    await loader.load(BUILTIN_ANALYTICS_PLUGINS[0]);
    await loader.load(BUILTIN_ANALYTICS_PLUGINS[1]);
    const plugins = loader.getPlugins();
    expect(plugins.length).toBeGreaterThanOrEqual(2);
    await loader.unload(BUILTIN_ANALYTICS_PLUGINS[0].id);
    await loader.unload(BUILTIN_ANALYTICS_PLUGINS[1].id);
  });

  it("throws on unload of non-existent plugin", async () => {
    await expect(loader.unload("nonexistent")).rejects.toThrow();
  });

  it("returns undefined for unknown plugin", () => {
    expect(loader.getPlugin("nonexistent")).toBeUndefined();
  });

  it("reports null lastError for loaded plugin", async () => {
    await loader.load(BUILTIN_ANALYTICS_PLUGINS[0]);
    expect(loader.getLastError(BUILTIN_ANALYTICS_PLUGINS[0].id)).toBeNull();
    await loader.unload(BUILTIN_ANALYTICS_PLUGINS[0].id);
  });

  it("returns undefined lastError for unknown plugin", () => {
    expect(loader.getLastError("nonexistent")).toBeNull();
  });

  it("provides the analytics SDK", () => {
    const sdk = loader.getAnalyticsSDK();
    expect(sdk).toBeDefined();
    expect(typeof sdk.getProtocolStats).toBe("function");
  });
});

describe("Malicious Plugin Isolation", () => {
  it("rejects plugin without required fields", async () => {
    const loader = new AnalyticsPluginLoader();
    const bad = { id: "bad", name: "Bad" } as AnalyticsPlugin;
    const result = await loader.load(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects plugin with duplicate metric ids", () => {
    const loader = new AnalyticsPluginLoader();
    const plugin: AnalyticsPlugin = {
      id: "dup-test",
      name: "Duplicate Test",
      version: "1.0.0",
      metrics: [
        { id: "m1", name: "M1", description: "", type: "number", compute: async () => 1 },
        { id: "m1", name: "M1 duplicate", description: "", type: "number", compute: async () => 2 },
      ],
      widgets: [],
    };
    expect(async () => {
      const result = await loader.load(plugin);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Duplicate metric id: "m1"');
    });
  });

  it("rejects plugin with duplicate widget ids", () => {
    const loader = new AnalyticsPluginLoader();
    const plugin: AnalyticsPlugin = {
      id: "dup-widget",
      name: "Duplicate Widget",
      version: "1.0.0",
      metrics: [],
      widgets: [
        { id: "w1", name: "W1", description: "", type: "chart", size: "small", render: async () => ({ type: "chart", data: {} }) },
        { id: "w1", name: "W1 dup", description: "", type: "chart", size: "small", render: async () => ({ type: "chart", data: {} }) },
      ],
    };
    expect(async () => {
      const result = await loader.load(plugin);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Duplicate widget id: "w1"');
    });
  });

  it("isolates plugin compute errors without affecting loader", async () => {
    const loader = new AnalyticsPluginLoader();
    const plugin: AnalyticsPlugin = {
      id: "error-test",
      name: "Error Test",
      version: "1.0.0",
      metrics: [
        {
          id: "failing",
          name: "Failing",
          description: "Always throws",
          type: "number",
          compute: async () => { throw new Error("compute failure"); },
        },
      ],
      widgets: [
        {
          id: "failing-widget",
          name: "Failing Widget",
          description: "Always throws",
          type: "metric",
          size: "small",
          render: async () => { throw new Error("render failure"); },
        },
      ],
    };

    await loader.load(plugin);
    await expect(loader.computeMetric("error-test", "failing")).rejects.toThrow("compute failure");
    await expect(loader.renderWidget("error-test", "failing-widget")).rejects.toThrow("render failure");
    expect(loader.getLastError("error-test")).toBeTruthy();
    await loader.unload("error-test");
  });

  it("install errors are caught and plugin is not registered", async () => {
    const loader = new AnalyticsPluginLoader();
    let installCalled = false;
    const plugin: AnalyticsPlugin = {
      id: "bad-install",
      name: "Bad Install",
      version: "1.0.0",
      metrics: [],
      widgets: [],
      install: async () => {
        installCalled = true;
        throw new Error("install rejected");
      },
    };
    const result = await loader.load(plugin);
    expect(installCalled).toBe(true);
    expect(result.valid).toBe(false);
    expect(loader.isLoaded("bad-install")).toBe(false);
  });
});
