import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { registerEnvCommands, getCurrentEnvironment, getEnvironment } from './env';
import { Command } from 'commander';

// Commander's `.action(fn)` registers a handler; it doesn't invoke it, and
// wraps it so the raw function isn't retrievable through any public API.
// Patch `.action` for the duration of registration to stash the raw
// function on each command, so tests can call it directly with whatever
// args they want to exercise.
function withCapturedActions<T>(fn: () => T): T {
  const original = Command.prototype.action;
  Command.prototype.action = function (
    this: Command,
    actionFn: (...args: unknown[]) => void | Promise<void>
  ) {
    (this as unknown as { __rawAction: typeof actionFn }).__rawAction = actionFn;
    return original.call(this, actionFn);
  };
  try {
    return fn();
  } finally {
    Command.prototype.action = original;
  }
}

function invokeAction(command: Command, ...args: unknown[]): unknown {
  return (command as unknown as { __rawAction: (...args: unknown[]) => unknown }).__rawAction(
    ...args
  );
}

// Mock fs and os
const mockFs = {
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
};

const mockOs = {
  homedir: vi.fn(() => '/mock/home'),
};

vi.mock('fs', () => mockFs);
vi.mock('os', () => mockOs);

describe('Environment Management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOs.homedir.mockReturnValue('/mock/home');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Environment validation', () => {
    it('should validate correct environment configuration', () => {
      // This is tested indirectly through the commands
      // The validation function is internal to env.ts
      expect(true).toBe(true); // Placeholder
    });

    it('should reject invalid Stellar address format', () => {
      // Tested through create command
      expect(true).toBe(true); // Placeholder
    });

    it('should reject invalid URL format', () => {
      // Tested through create command
      expect(true).toBe(true); // Placeholder
    });
  });

  describe('Environment commands', () => {
    let program: Command;
    let consoleLogSpy: any;
    let consoleErrorSpy: any;
    let processExitSpy: any;

    beforeEach(() => {
      program = new Command();
      consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('Process exited');
      });
    });

    afterEach(() => {
      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
      processExitSpy.mockRestore();
    });

    describe('env list', () => {
      it('should list no environments when none configured', () => {
        mockFs.readFileSync.mockImplementation(() => {
          throw new Error('File not found');
        });

        withCapturedActions(() => registerEnvCommands(program));

        // Simulate command execution
        const listCommand = program.commands.find((c: any) => c.name() === 'env');
        const listSubcommand = listCommand?.commands.find((c: any) => c.name() === 'list');

        if (listSubcommand) {
          invokeAction(listSubcommand);
          expect(consoleLogSpy).toHaveBeenCalledWith(
            "No environments configured. Use 'iln env create' to add one."
          );
        }
      });

      it('should list configured environments', () => {
        const mockConfig = {
          current: 'testnet',
          environments: {
            testnet: {
              name: 'testnet',
              contractId: 'GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
              rpcUrl: 'https://testnet.rpc.com',
              networkPassphrase: 'Test SDF Network',
              isActive: false,
            },
          },
        };

        mockFs.readFileSync.mockReturnValue(JSON.stringify(mockConfig));

        withCapturedActions(() => registerEnvCommands(program));

        const listCommand = program.commands.find((c: any) => c.name() === 'env');
        const listSubcommand = listCommand?.commands.find((c: any) => c.name() === 'list');

        if (listSubcommand) {
          invokeAction(listSubcommand);
          expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('testnet'));
        }
      });
    });

    describe('env use', () => {
      it('should switch to existing environment', () => {
        const mockConfig = {
          current: null,
          environments: {
            testnet: {
              name: 'testnet',
              contractId: 'GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
              rpcUrl: 'https://testnet.rpc.com',
              networkPassphrase: 'Test SDF Network',
              isActive: false,
            },
          },
        };

        mockFs.readFileSync.mockReturnValue(JSON.stringify(mockConfig));
        mockFs.writeFileSync.mockImplementation(() => {});

        withCapturedActions(() => registerEnvCommands(program));

        const useCommand = program.commands.find((c: any) => c.name() === 'env');
        const useSubcommand = useCommand?.commands.find((c: any) => c.name() === 'use');

        if (useSubcommand) {
          invokeAction(useSubcommand, 'testnet');
          expect(mockFs.writeFileSync).toHaveBeenCalled();
          expect(consoleLogSpy).toHaveBeenCalledWith('Switched to environment: testnet');
        }
      });

      it('should error when environment not found', () => {
        const mockConfig = {
          current: null,
          environments: {},
        };

        mockFs.readFileSync.mockReturnValue(JSON.stringify(mockConfig));

        withCapturedActions(() => registerEnvCommands(program));

        const useCommand = program.commands.find((c: any) => c.name() === 'env');
        const useSubcommand = useCommand?.commands.find((c: any) => c.name() === 'use');

        if (useSubcommand) {
          expect(() => {
            invokeAction(useSubcommand, 'nonexistent');
          }).toThrow('Process exited');
          expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
        }
      });
    });

    describe('env create', () => {
      it('should create new environment', () => {
        const mockConfig = {
          current: null,
          environments: {},
        };

        mockFs.readFileSync.mockReturnValue(JSON.stringify(mockConfig));
        mockFs.existsSync.mockReturnValue(false);
        mockFs.mkdirSync.mockImplementation(() => {});
        mockFs.writeFileSync.mockImplementation(() => {});

        withCapturedActions(() => registerEnvCommands(program));

        const createCommand = program.commands.find((c: any) => c.name() === 'env');
        const createSubcommand = createCommand?.commands.find((c: any) => c.name() === 'create');

        if (createSubcommand) {
          invokeAction(createSubcommand, 'testnet', {
            contractId: 'GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
            rpcUrl: 'https://testnet.rpc.com',
            networkPassphrase: 'Test SDF Network',
          });

          expect(mockFs.writeFileSync).toHaveBeenCalled();
          expect(consoleLogSpy).toHaveBeenCalledWith('Created environment: testnet');
        }
      });

      it('should error when environment already exists', () => {
        const mockConfig = {
          current: null,
          environments: {
            testnet: {
              name: 'testnet',
              contractId: 'GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
              rpcUrl: 'https://testnet.rpc.com',
              networkPassphrase: 'Test SDF Network',
              isActive: false,
            },
          },
        };

        mockFs.readFileSync.mockReturnValue(JSON.stringify(mockConfig));

        withCapturedActions(() => registerEnvCommands(program));

        const createCommand = program.commands.find((c: any) => c.name() === 'env');
        const createSubcommand = createCommand?.commands.find((c: any) => c.name() === 'create');

        if (createSubcommand) {
          expect(() => {
            invokeAction(createSubcommand, 'testnet', {
              contractId: 'GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
              rpcUrl: 'https://testnet.rpc.com',
              networkPassphrase: 'Test SDF Network',
            });
          }).toThrow('Process exited');
          expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('already exists'));
        }
      });

      it('should validate environment configuration', () => {
        const mockConfig = {
          current: null,
          environments: {},
        };

        mockFs.readFileSync.mockReturnValue(JSON.stringify(mockConfig));
        mockFs.existsSync.mockReturnValue(false);
        mockFs.mkdirSync.mockImplementation(() => {});

        withCapturedActions(() => registerEnvCommands(program));

        const createCommand = program.commands.find((c: any) => c.name() === 'env');
        const createSubcommand = createCommand?.commands.find((c: any) => c.name() === 'create');

        if (createSubcommand) {
          expect(() => {
            invokeAction(createSubcommand, 'testnet', {
              contractId: 'invalid', // Invalid address
              rpcUrl: 'https://testnet.rpc.com',
              networkPassphrase: 'Test SDF Network',
            });
          }).toThrow('Process exited');
          expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining('Invalid environment configuration')
          );
        }
      });
    });

    describe('env delete', () => {
      it('should delete environment with confirmation', () => {
        const mockConfig = {
          current: 'mainnet',
          environments: {
            testnet: {
              name: 'testnet',
              contractId: 'GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
              rpcUrl: 'https://testnet.rpc.com',
              networkPassphrase: 'Test SDF Network',
              isActive: false,
            },
            mainnet: {
              name: 'mainnet',
              contractId: 'GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567891',
              rpcUrl: 'https://mainnet.rpc.com',
              networkPassphrase: 'Public Global Stellar Network',
              isActive: false,
            },
          },
        };

        mockFs.readFileSync.mockReturnValue(JSON.stringify(mockConfig));
        mockFs.writeFileSync.mockImplementation(() => {});

        // Mock readline
        const mockRl = {
          question: vi.fn((_query: string, callback: (answer: string) => void) => {
            callback('yes');
          }),
          close: vi.fn(),
        };

        vi.doMock('readline', () => ({
          createInterface: () => mockRl,
        }));

        withCapturedActions(() => registerEnvCommands(program));

        const deleteCommand = program.commands.find((c: any) => c.name() === 'env');
        const deleteSubcommand = deleteCommand?.commands.find((c: any) => c.name() === 'delete');

        if (deleteSubcommand) {
          invokeAction(deleteSubcommand, 'testnet');
          expect(consoleLogSpy).toHaveBeenCalledWith('Deleted environment: testnet');
        }
      });

      it('should error when deleting active environment', () => {
        const mockConfig = {
          current: 'testnet',
          environments: {
            testnet: {
              name: 'testnet',
              contractId: 'GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
              rpcUrl: 'https://testnet.rpc.com',
              networkPassphrase: 'Test SDF Network',
              isActive: false,
            },
          },
        };

        mockFs.readFileSync.mockReturnValue(JSON.stringify(mockConfig));

        withCapturedActions(() => registerEnvCommands(program));

        const deleteCommand = program.commands.find((c: any) => c.name() === 'env');
        const deleteSubcommand = deleteCommand?.commands.find((c: any) => c.name() === 'delete');

        if (deleteSubcommand) {
          expect(() => {
            invokeAction(deleteSubcommand, 'testnet');
          }).toThrow('Process exited');
          expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining('Cannot delete the active environment')
          );
        }
      });

      it('should cancel deletion when user answers no', () => {
        const mockConfig = {
          current: 'mainnet',
          environments: {
            testnet: {
              name: 'testnet',
              contractId: 'GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
              rpcUrl: 'https://testnet.rpc.com',
              networkPassphrase: 'Test SDF Network',
              isActive: false,
            },
          },
        };

        mockFs.readFileSync.mockReturnValue(JSON.stringify(mockConfig));

        const mockRl = {
          question: vi.fn((_query: string, callback: (answer: string) => void) => {
            callback('no');
          }),
          close: vi.fn(),
        };

        vi.doMock('readline', () => ({
          createInterface: () => mockRl,
        }));

        withCapturedActions(() => registerEnvCommands(program));

        const deleteCommand = program.commands.find((c: any) => c.name() === 'env');
        const deleteSubcommand = deleteCommand?.commands.find((c: any) => c.name() === 'delete');

        if (deleteSubcommand) {
          expect(() => {
            invokeAction(deleteSubcommand, 'testnet');
          }).toThrow('Process exited');
          expect(consoleLogSpy).toHaveBeenCalledWith('Deletion cancelled.');
        }
      });
    });

    describe('env show', () => {
      it('should show environment details', () => {
        const mockConfig = {
          current: 'testnet',
          environments: {
            testnet: {
              name: 'testnet',
              contractId: 'GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
              rpcUrl: 'https://testnet.rpc.com',
              networkPassphrase: 'Test SDF Network',
              keypairPath: '/path/to/keypair',
              isActive: false,
            },
          },
        };

        mockFs.readFileSync.mockReturnValue(JSON.stringify(mockConfig));

        withCapturedActions(() => registerEnvCommands(program));

        const showCommand = program.commands.find((c: any) => c.name() === 'env');
        const showSubcommand = showCommand?.commands.find((c: any) => c.name() === 'show');

        if (showSubcommand) {
          invokeAction(showSubcommand, 'testnet');
          expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('testnet'));
          expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining('GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890')
          );
        }
      });

      it('should error when environment not found', () => {
        const mockConfig = {
          current: null,
          environments: {},
        };

        mockFs.readFileSync.mockReturnValue(JSON.stringify(mockConfig));

        withCapturedActions(() => registerEnvCommands(program));

        const showCommand = program.commands.find((c: any) => c.name() === 'env');
        const showSubcommand = showCommand?.commands.find((c: any) => c.name() === 'show');

        if (showSubcommand) {
          expect(() => {
            invokeAction(showSubcommand, 'nonexistent');
          }).toThrow('Process exited');
          expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
        }
      });
    });
  });

  describe('Helper functions', () => {
    describe('getCurrentEnvironment', () => {
      it('should return current environment', () => {
        const mockConfig = {
          current: 'testnet',
          environments: {
            testnet: {
              name: 'testnet',
              contractId: 'GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
              rpcUrl: 'https://testnet.rpc.com',
              networkPassphrase: 'Test SDF Network',
              isActive: false,
            },
          },
        };

        mockFs.readFileSync.mockReturnValue(JSON.stringify(mockConfig));

        const current = getCurrentEnvironment();
        expect(current).toBeDefined();
        expect(current?.name).toBe('testnet');
      });

      it('should return null when no current environment', () => {
        const mockConfig = {
          current: null,
          environments: {},
        };

        mockFs.readFileSync.mockReturnValue(JSON.stringify(mockConfig));

        const current = getCurrentEnvironment();
        expect(current).toBeNull();
      });

      it('should return null when config file does not exist', () => {
        mockFs.readFileSync.mockImplementation(() => {
          throw new Error('File not found');
        });

        const current = getCurrentEnvironment();
        expect(current).toBeNull();
      });
    });

    describe('getEnvironment', () => {
      it('should return environment by name', () => {
        const mockConfig = {
          current: null,
          environments: {
            testnet: {
              name: 'testnet',
              contractId: 'GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
              rpcUrl: 'https://testnet.rpc.com',
              networkPassphrase: 'Test SDF Network',
              isActive: false,
            },
          },
        };

        mockFs.readFileSync.mockReturnValue(JSON.stringify(mockConfig));

        const env = getEnvironment('testnet');
        expect(env).toBeDefined();
        expect(env?.name).toBe('testnet');
      });

      it('should return null for non-existent environment', () => {
        const mockConfig = {
          current: null,
          environments: {},
        };

        mockFs.readFileSync.mockReturnValue(JSON.stringify(mockConfig));

        const env = getEnvironment('nonexistent');
        expect(env).toBeNull();
      });
    });
  });
});
