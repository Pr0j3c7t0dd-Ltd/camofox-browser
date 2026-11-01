import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { jest } from '@jest/globals';
import { createPluginEvents } from '../../lib/plugins.js';
import { register } from './index.js';

describe('persistence plugin', () => {
  let tmpDir, events, ctx, mockApp;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'camofox-persist-plugin-'));
    events = createPluginEvents();
    mockApp = {};
    ctx = {
      events,
      config: { cookiesDir: path.join(tmpDir, 'cookies') },
      log: jest.fn(),
    };
  });

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('skips registration when no profileDir configured', async () => {
    await register(mockApp, ctx, {});
    expect(ctx.log).toHaveBeenCalledWith('warn', expect.stringContaining('no profileDir'));
  });

  test('restores persisted state on session:creating', async () => {
    await register(mockApp, ctx, { profileDir: tmpDir });

    // Simulate a prior persisted state
    const { getUserPersistencePaths } = await import('../../lib/persistence.js');
    const { userDir, storageStatePath } = getUserPersistencePaths(tmpDir, 'user-1');
    await fs.mkdir(userDir, { recursive: true });
    await fs.writeFile(storageStatePath, JSON.stringify({
      cookies: [{ name: 'sid', value: 'abc', domain: '.example.com', path: '/' }],
      origins: [],
    }));

    const contextOptions = { viewport: { width: 1280, height: 720 } };
    await events.emitAsync('session:creating', { userId: 'user-1', contextOptions });

    expect(contextOptions.storageState).toBe(storageStatePath);
  });

  test('checkpoints on session:cookies:import', async () => {
    await register(mockApp, ctx, { profileDir: tmpDir });

    const mockContext = {
      storageState: jest.fn(async ({ path: p }) => {
        await fs.writeFile(p, JSON.stringify({ cookies: [{ name: 'x', value: 'y', domain: '.test.com', path: '/' }] }));
      }),
    };

    // Simulate session created then cookie import
    await events.emitAsync('session:created', { userId: 'user-2', context: mockContext });
    await events.emitAsync('session:cookies:import', { userId: 'user-2' });

    expect(mockContext.storageState).toHaveBeenCalled();

    // Verify file was written
    const { getUserPersistencePaths } = await import('../../lib/persistence.js');
    const { storageStatePath } = getUserPersistencePaths(tmpDir, 'user-2');
    const saved = JSON.parse(await fs.readFile(storageStatePath, 'utf8'));
    expect(saved.cookies[0].name).toBe('x');
  });

  test('checkpoints on session:destroying', async () => {
    await register(mockApp, ctx, { profileDir: tmpDir });

    const mockContext = {
      storageState: jest.fn(async ({ path: p }) => {
        await fs.writeFile(p, JSON.stringify({ cookies: [], origins: [] }));
      }),
    };

    await events.emitAsync('session:created', { userId: 'user-3', context: mockContext });
    await events.emitAsync('session:destroying', { userId: 'user-3', reason: 'test' });

    expect(mockContext.storageState).toHaveBeenCalled();
  });

  test('checkpoints on the shutdown prepare phase, before teardown runs', async () => {
    await register(mockApp, ctx, { profileDir: tmpDir });

    const order = [];
    const mockContext = {
      storageState: jest.fn(async ({ path: p }) => {
        order.push('persist');
        await fs.writeFile(p, JSON.stringify({ cookies: [], origins: [] }));
      }),
    };
    // A teardown listener on server:shutdown, like the VNC plugin's
    events.on('server:shutdown', () => order.push('teardown'));

    await events.emitAsync('session:created', { userId: 'user-4', context: mockContext });
    await events.emitAsync('server:shutdown:prepare', { signal: 'SIGTERM' });
    await events.emitAsync('server:shutdown', { signal: 'SIGTERM' });

    expect(mockContext.storageState).toHaveBeenCalled();
    expect(order).toEqual(['persist', 'teardown']);
  });

  test('checkpoints after a navigation, which is when a login lands', async () => {
    jest.useFakeTimers();
    try {
      process.env.CAMOFOX_CHECKPOINT_DEBOUNCE_MS = '10000';
      await register(mockApp, ctx, { profileDir: tmpDir });

      const mockContext = {
        storageState: jest.fn(async ({ path: p }) => {
          await fs.writeFile(p, JSON.stringify({ cookies: [], origins: [] }));
        }),
      };

      await events.emitAsync('session:created', { userId: 'user-5', context: mockContext });
      await events.emitAsync('tab:navigated', { userId: 'user-5', url: 'https://example.com/after-login' });

      // Debounced: nothing written yet, the page may still be redirecting
      expect(mockContext.storageState).not.toHaveBeenCalled();

      // Several navigations inside the window collapse into one write
      await events.emitAsync('tab:navigated', { userId: 'user-5', url: 'https://example.com/step2' });
      await events.emitAsync('tab:navigated', { userId: 'user-5', url: 'https://example.com/step3' });

      jest.advanceTimersByTime(10000);
      jest.useRealTimers();
      // Let the async write (mkdir + writeFile) settle on the real event loop
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockContext.storageState).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
      delete process.env.CAMOFOX_CHECKPOINT_DEBOUNCE_MS;
    }
  });

  test('env var CAMOFOX_PROFILE_DIR overrides pluginConfig', async () => {
    const envDir = path.join(tmpDir, 'env-override');
    const orig = process.env.CAMOFOX_PROFILE_DIR;
    process.env.CAMOFOX_PROFILE_DIR = envDir;
    try {
      await register(mockApp, ctx, { profileDir: '/should/not/use' });
      expect(ctx.log).toHaveBeenCalledWith('info', 'persistence plugin enabled', { profileDir: envDir });
    } finally {
      if (orig === undefined) delete process.env.CAMOFOX_PROFILE_DIR;
      else process.env.CAMOFOX_PROFILE_DIR = orig;
    }
  });
});
