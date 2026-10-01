import { createLogger } from './logger';
import type { ILNEventEmitter } from './event-emitter';
import { AnalyticsSDK } from './analytics';

const logger = createLogger('plugins');

export interface PluginContext {
  readonly logger: (msg: string, data?: unknown) => void;
  readonly emitter: ILNEventEmitter;
  readonly config: Record<string, unknown>;
}

export interface ILNPlugin {
  name: string;
  version?: string;
  install?(ctx: PluginContext): void | Promise<void>;
  onBeforeOperation?(name: string, params: unknown): void | Promise<void>;
  onAfterOperation?(name: string, result: unknown): void | Promise<void>;
  onError?(name: string, error: unknown): void | Promise<void>;
  destroy?(): void | Promise<void>;
}

type RegistryEntry = { plugin: ILNPlugin; ctx: PluginContext };

type DispatchableHook = keyof Pick<ILNPlugin, 'onBeforeOperation' | 'onAfterOperation' | 'onError'>;

export class PluginRegistry {
  private readonly plugins: Map<string, RegistryEntry> = new Map();
  private readonly emitter: ILNEventEmitter;

  constructor(emitter: ILNEventEmitter) {
    this.emitter = emitter;
  }

  async register(plugin: ILNPlugin, config?: Record<string, unknown>): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered.`);
    }

    const ctx: PluginContext = {
      logger: (msg, data) => {
        if (logger.enabled) logger(`[${plugin.name}] ${msg}`, data);
      },
      emitter: this.emitter,
      config: config ?? {},
    };

    await plugin.install?.(ctx);
    this.plugins.set(plugin.name, { plugin, ctx });
    logger(`registered: ${plugin.name}${plugin.version ? `@${plugin.version}` : ''}`);
  }

  async unregister(name: string): Promise<void> {
    const entry = this.plugins.get(name);
    if (!entry) {
      throw new Error(`Plugin "${name}" is not registered.`);
    }
    await entry.plugin.destroy?.();
    this.plugins.delete(name);
    logger(`unregistered: ${name}`);
  }

  has(name: string): boolean {
    return this.plugins.has(name);
  }

  list(): string[] {
    return Array.from(this.plugins.keys());
  }

  private async runHook(hookName: DispatchableHook, ...args: unknown[]): Promise<void> {
    for (const { plugin } of this.plugins.values()) {
      const hook = plugin[hookName] as ((...a: unknown[]) => void | Promise<void>) | undefined;
      if (!hook) continue;
      try {
        await hook.call(plugin, ...args);
      } catch {
        // swallow per-plugin errors — one bad plugin must not affect others
      }
    }
  }

  async runBeforeOperation(name: string, params: unknown): Promise<void> {
    return this.runHook('onBeforeOperation', name, params);
  }

  async runAfterOperation(name: string, result: unknown): Promise<void> {
    return this.runHook('onAfterOperation', name, result);
  }

  async runOnError(name: string, error: unknown): Promise<void> {
    return this.runHook('onError', name, error);
  }
}

// =============================================================================
// Analytics Plugin System
// =============================================================================

export type WidgetSize = 'small' | 'medium' | 'large' | 'full';
export type WidgetType = 'chart' | 'table' | 'metric' | 'heatmap' | 'custom';

export interface MetricDefinition {
  id: string;
  name: string;
  description: string;
  type: 'number' | 'percentage' | 'duration' | 'currency' | 'ratio';
  defaultValue?: number | bigint;
  compute: (context: AnalyticsPluginContext) => Promise<number | bigint | string>;
}

export interface WidgetDefinition {
  id: string;
  name: string;
  description: string;
  type: WidgetType;
  size: WidgetSize;
  refreshIntervalMs?: number;
  render: (context: AnalyticsPluginContext) => Promise<WidgetRenderResult>;
}

export interface WidgetRenderResult {
  type: WidgetType;
  data: unknown;
  labels?: string[];
  series?: Array<{ name: string; values: number[] }>;
  metadata?: Record<string, unknown>;
}

export interface AnalyticsPluginContext {
  readonly sdk: AnalyticsSDK;
  readonly logger: (msg: string, data?: unknown) => void;
  readonly config: Record<string, unknown>;
  readonly cache: Map<string, { data: unknown; expiry: number }>;
  readonly fetchFromCache: <T>(key: string) => T | undefined;
  readonly setCache: <T>(key: string, data: T, ttlMs: number) => void;
}

export interface AnalyticsPlugin {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  icon?: string;
  metrics: MetricDefinition[];
  widgets: WidgetDefinition[];
  install?(context: AnalyticsPluginContext): void | Promise<void>;
  destroy?(): void | Promise<void>;
}

export interface PluginValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface AnalyticsPluginState {
  plugin: AnalyticsPlugin;
  enabled: boolean;
  installedAt: number;
  lastError: string | null;
}

function validatePlugin(plugin: AnalyticsPlugin): PluginValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!plugin.id || typeof plugin.id !== 'string') {
    errors.push('Plugin must have a string `id`');
  }
  if (!plugin.name || typeof plugin.name !== 'string') {
    errors.push('Plugin must have a string `name`');
  }
  if (!plugin.version || typeof plugin.version !== 'string') {
    errors.push('Plugin must have a string `version`');
  }
  if (!/^\d+\.\d+\.\d+/.test(plugin.version ?? '')) {
    warnings.push('Plugin version should follow semver (e.g. 1.0.0)');
  }
  if (!Array.isArray(plugin.metrics)) {
    errors.push('Plugin must have a `metrics` array');
  }
  if (!Array.isArray(plugin.widgets)) {
    errors.push('Plugin must have a `widgets` array');
  }

  if (Array.isArray(plugin.metrics)) {
    const metricIds = new Set<string>();
    for (const m of plugin.metrics) {
      if (!m.id || typeof m.id !== 'string') {
        errors.push('Each metric must have a string `id`');
      } else if (metricIds.has(m.id)) {
        errors.push(`Duplicate metric id: "${m.id}"`);
      } else {
        metricIds.add(m.id);
      }
      if (!m.name) errors.push(`Metric "${m.id}" must have a "name"`);
      if (typeof m.compute !== 'function') {
        errors.push(`Metric "${m.id}" must have a "compute" function`);
      }
    }
  }

  if (Array.isArray(plugin.widgets)) {
    const widgetIds = new Set<string>();
    for (const w of plugin.widgets) {
      if (!w.id || typeof w.id !== 'string') {
        errors.push('Each widget must have a string `id`');
      } else if (widgetIds.has(w.id)) {
        errors.push(`Duplicate widget id: "${w.id}"`);
      } else {
        widgetIds.add(w.id);
      }
      if (!w.name) errors.push(`Widget "${w.id}" must have a "name"`);
      if (typeof w.render !== 'function') {
        errors.push(`Widget "${w.id}" must have a "render" function`);
      }
      if (!['small', 'medium', 'large', 'full'].includes(w.size)) {
        warnings.push(`Widget "${w.id}" has unknown size "${w.size}"`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export class AnalyticsPluginLoader {
  private readonly plugins = new Map<string, AnalyticsPluginState>();
  private readonly contextCache = new Map<string, Map<string, { data: unknown; expiry: number }>>();
  private readonly sdk: AnalyticsSDK;

  constructor(baseUrl?: string) {
    this.sdk = new AnalyticsSDK(baseUrl);
  }

  getAnalyticsSDK(): AnalyticsSDK {
    return this.sdk;
  }

  async load(plugin: AnalyticsPlugin): Promise<PluginValidationResult> {
    const validation = validatePlugin(plugin);
    if (!validation.valid) {
      logger(`plugin validation failed: ${plugin.id}`, validation.errors);
      return validation;
    }

    const existing = this.plugins.get(plugin.id);
    if (existing && existing.enabled) {
      validation.errors.push(`Plugin "${plugin.id}" is already loaded`);
      validation.valid = false;
      return validation;
    }

    const cache = new Map<string, { data: unknown; expiry: number }>();

    const context: AnalyticsPluginContext = {
      sdk: this.sdk,
      logger: (msg, data) => {
        logger(`[${plugin.id}] ${msg}`, data);
      },
      config: {},
      cache,
      fetchFromCache: <T>(key: string): T | undefined => {
        const entry = cache.get(key);
        if (!entry) return undefined;
        if (Date.now() > entry.expiry) {
          cache.delete(key);
          return undefined;
        }
        return entry.data as T;
      },
      setCache: <T>(key: string, data: T, ttlMs: number) => {
        cache.set(key, { data, expiry: Date.now() + ttlMs });
      },
    };

    try {
      await plugin.install?.(context);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger(`plugin install error: ${plugin.id}: ${msg}`);
      validation.errors.push(`Install failed: ${msg}`);
      validation.valid = false;
      return validation;
    }

    const state: AnalyticsPluginState = {
      plugin,
      enabled: true,
      installedAt: Date.now(),
      lastError: null,
    };

    this.plugins.set(plugin.id, state);
    this.contextCache.set(plugin.id, cache);

    logger(`loaded analytics plugin: ${plugin.id}@${plugin.version}`);
    return validation;
  }

  async unload(pluginId: string): Promise<void> {
    const state = this.plugins.get(pluginId);
    if (!state) {
      throw new Error(`Plugin "${pluginId}" is not loaded`);
    }
    try {
      await state.plugin.destroy?.();
    } catch (err) {
      logger(`plugin destroy error: ${pluginId}: ${err}`);
    }
    this.plugins.delete(pluginId);
    this.contextCache.delete(pluginId);
    logger(`unloaded analytics plugin: ${pluginId}`);
  }

  getPlugin(pluginId: string): AnalyticsPlugin | undefined {
    return this.plugins.get(pluginId)?.plugin;
  }

  getPlugins(): AnalyticsPlugin[] {
    return Array.from(this.plugins.values())
      .filter((s) => s.enabled)
      .map((s) => s.plugin);
  }

  isLoaded(pluginId: string): boolean {
    return this.plugins.has(pluginId) && this.plugins.get(pluginId)!.enabled;
  }

  async computeMetric(pluginId: string, metricId: string): Promise<number | bigint | string> {
    const state = this.plugins.get(pluginId);
    if (!state || !state.enabled) {
      throw new Error(`Plugin "${pluginId}" is not loaded`);
    }
    const metric = state.plugin.metrics.find((m) => m.id === metricId);
    if (!metric) {
      throw new Error(`Metric "${metricId}" not found in plugin "${pluginId}"`);
    }

    const cache = this.contextCache.get(pluginId) ?? new Map();
    const context: AnalyticsPluginContext = {
      sdk: this.sdk,
      logger: (msg, data) => logger(`[${pluginId}] ${msg}`, data),
      config: {},
      cache,
      fetchFromCache: <T>(key: string): T | undefined => {
        const entry = cache.get(key);
        if (!entry) return undefined;
        if (Date.now() > entry.expiry) {
          cache.delete(key);
          return undefined;
        }
        return entry.data as T;
      },
      setCache: <T>(key: string, data: T, ttlMs: number) => {
        cache.set(key, { data, expiry: Date.now() + ttlMs });
      },
    };

    try {
      const result = await metric.compute(context);
      state.lastError = null;
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      state.lastError = msg;
      logger(`metric compute error: ${pluginId}/${metricId}: ${msg}`);
      throw err;
    }
  }

  async renderWidget(pluginId: string, widgetId: string): Promise<WidgetRenderResult> {
    const state = this.plugins.get(pluginId);
    if (!state || !state.enabled) {
      throw new Error(`Plugin "${pluginId}" is not loaded`);
    }
    const widget = state.plugin.widgets.find((w) => w.id === widgetId);
    if (!widget) {
      throw new Error(`Widget "${widgetId}" not found in plugin "${pluginId}"`);
    }

    const cache = this.contextCache.get(pluginId) ?? new Map();
    const context: AnalyticsPluginContext = {
      sdk: this.sdk,
      logger: (msg, data) => logger(`[${pluginId}] ${msg}`, data),
      config: {},
      cache,
      fetchFromCache: <T>(key: string): T | undefined => {
        const entry = cache.get(key);
        if (!entry) return undefined;
        if (Date.now() > entry.expiry) {
          cache.delete(key);
          return undefined;
        }
        return entry.data as T;
      },
      setCache: <T>(key: string, data: T, ttlMs: number) => {
        cache.set(key, { data, expiry: Date.now() + ttlMs });
      },
    };

    try {
      const result = await widget.render(context);
      state.lastError = null;
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      state.lastError = msg;
      logger(`widget render error: ${pluginId}/${widgetId}: ${msg}`);
      throw err;
    }
  }

  getLastError(pluginId: string): string | null {
    return this.plugins.get(pluginId)?.lastError ?? null;
  }
}
