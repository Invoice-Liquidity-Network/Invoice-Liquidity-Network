import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VersionManager } from '../version';

/**
 * Mock UI to capture output
 */
const createMockUi = () => ({
  info: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
});

describe('VersionManager', () => {
  let mockUi: any;

  beforeEach(() => {
    mockUi = createMockUi();
  });

  it('should detect outdated versions', async () => {
    const vm = new VersionManager(mockUi);

    // Mock package.json version
    vi.spyOn(vm, 'getCurrentVersion').mockReturnValue('0.1.0');

    const info = await vm.checkForUpdates();

    expect(info.current).toBe('0.1.0');
    expect(info.latest).toBe('1.0.0');
    expect(info.isOutdated).toBe(true);
  });

  it('should show success when already up to date', async () => {
    const vm = new VersionManager(mockUi);
    vi.spyOn(vm, 'getCurrentVersion').mockReturnValue('1.0.0');

    const info = await vm.checkForUpdates();
    expect(info.isOutdated).toBe(false);

    await vm.performUpdate();
    expect(mockUi.success).toHaveBeenCalledWith('CLI is already up to date.');
  });

  it('should show version notification when outdated', async () => {
    const vm = new VersionManager(mockUi);
    vi.spyOn(vm, 'getCurrentVersion').mockReturnValue('0.1.0');

    await vm.notifyUpdateIfAvailable();

    // Should have called ui.info multiple times including the update message
    expect(mockUi.info).toHaveBeenCalled();
    const allCalls = mockUi.info.mock.calls.flat().join(' ');
    expect(allCalls).toContain('Update available!');
    expect(allCalls).toContain('iln update');
  });
});
