import { describe, it, expect, vi } from 'vitest';
import type { PluginContext, ILNPlugin } from './plugins';
import { PluginRegistry } from './plugins';
import { ILNEventEmitter } from './event-emitter';

function makeEmitter() {
  return new ILNEventEmitter();
}

describe('PluginRegistry', () => {
  it('registers a plugin and calls install', async () => {
    const emitter = makeEmitter();
    const registry = new PluginRegistry(emitter);
    const install = vi.fn();
    const plugin: ILNPlugin = { name: 'test-plugin', install };

    await registry.register(plugin);

    expect(install).toHaveBeenCalledOnce();
    expect(registry.has('test-plugin')).toBe(true);
    expect(registry.list()).toContain('test-plugin');
  });

  it('registers plugin without install hook', async () => {
    const registry = new PluginRegistry(makeEmitter());
    await expect(registry.register({ name: 'no-install' })).resolves.toBeUndefined();
    expect(registry.has('no-install')).toBe(true);
  });

  it('throws on duplicate registration', async () => {
    const registry = new PluginRegistry(makeEmitter());
    const plugin: ILNPlugin = { name: 'dup' };

    await registry.register(plugin);
    await expect(registry.register(plugin)).rejects.toThrow(/already registered/);
  });

  it('unregisters a plugin and calls destroy', async () => {
    const registry = new PluginRegistry(makeEmitter());
    const destroy = vi.fn();
    const plugin: ILNPlugin = { name: 'removable', destroy };

    await registry.register(plugin);
    await registry.unregister('removable');

    expect(destroy).toHaveBeenCalledOnce();
    expect(registry.has('removable')).toBe(false);
    expect(registry.list()).not.toContain('removable');
  });

  it('throws when unregistering unknown plugin', async () => {
    const registry = new PluginRegistry(makeEmitter());
    await expect(registry.unregister('ghost')).rejects.toThrow(/not registered/);
  });

  it('list() returns registered plugin names in order', async () => {
    const registry = new PluginRegistry(makeEmitter());
    await registry.register({ name: 'alpha' });
    await registry.register({ name: 'beta' });
    expect(registry.list()).toEqual(['alpha', 'beta']);
  });

  it('fires onBeforeOperation hooks in registration order', async () => {
    const calls: string[] = [];
    const registry = new PluginRegistry(makeEmitter());

    await registry.register({
      name: 'a',
      onBeforeOperation: async () => {
        calls.push('a');
      },
    });
    await registry.register({
      name: 'b',
      onBeforeOperation: async () => {
        calls.push('b');
      },
    });

    await registry.runBeforeOperation('submitInvoice', {});
    expect(calls).toEqual(['a', 'b']);
  });

  it('fires onAfterOperation hooks', async () => {
    const calls: string[] = [];
    const registry = new PluginRegistry(makeEmitter());

    await registry.register({
      name: 'logger-plugin',
      onAfterOperation: async (name) => {
        calls.push(name as string);
      },
    });

    await registry.runAfterOperation('fundInvoice', { id: 1n });
    expect(calls).toEqual(['fundInvoice']);
  });

  it('fires onError hooks', async () => {
    const errors: unknown[] = [];
    const registry = new PluginRegistry(makeEmitter());

    await registry.register({
      name: 'err-tracker',
      onError: async (_name, error) => {
        errors.push(error);
      },
    });

    const err = new Error('rpc failed');
    await registry.runOnError('submitInvoice', err);
    expect(errors).toContain(err);
  });

  it('swallows errors from individual plugins without stopping others', async () => {
    const calls: string[] = [];
    const registry = new PluginRegistry(makeEmitter());

    await registry.register({
      name: 'bad',
      onAfterOperation: () => {
        throw new Error('plugin error');
      },
    });
    await registry.register({
      name: 'good',
      onAfterOperation: async () => {
        calls.push('good');
      },
    });

    await expect(registry.runAfterOperation('fundInvoice', { id: 1n })).resolves.toBeUndefined();
    expect(calls).toContain('good');
  });

  it('passes config to PluginContext', async () => {
    let receivedConfig: Record<string, unknown> | undefined;
    const registry = new PluginRegistry(makeEmitter());

    await registry.register(
      {
        name: 'configured',
        install(ctx: PluginContext) {
          receivedConfig = ctx.config;
        },
      },
      { apiKey: 'secret', timeout: 5000 }
    );

    expect(receivedConfig).toEqual({ apiKey: 'secret', timeout: 5000 });
  });

  it('passes emitter on PluginContext', async () => {
    const emitter = makeEmitter();
    const registry = new PluginRegistry(emitter);
    let ctxEmitter: unknown;

    await registry.register({
      name: 'emitter-check',
      install(ctx) {
        ctxEmitter = ctx.emitter;
      },
    });

    expect(ctxEmitter).toBe(emitter);
  });

  it('skips hooks not defined on plugin', async () => {
    const registry = new PluginRegistry(makeEmitter());
    await registry.register({ name: 'minimal' }); // no hooks defined

    await expect(registry.runBeforeOperation('getProtocolConfig', {})).resolves.toBeUndefined();
    await expect(registry.runAfterOperation('getProtocolConfig', {})).resolves.toBeUndefined();
    await expect(
      registry.runOnError('getProtocolConfig', new Error('err'))
    ).resolves.toBeUndefined();
  });
});
