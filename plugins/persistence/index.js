/**
 * Persistence plugin for camofox-browser.
 *
 * Saves and restores per-user browser storage state (cookies + localStorage)
 * across session restarts using Playwright's storageState API.
 *
 * Configuration (camofox.config.json):
 *   {
 *     "plugins": {
 *       "persistence": {
 *         "enabled": true,
 *         "profileDir": "/data/profiles"
 *       }
 *     }
 *   }
 *
 * Or via environment variables (overrides config file):
 *   CAMOFOX_PROFILE_DIR=/data/profiles
 *
 * Each userId gets a deterministic SHA256-hashed subdirectory under profileDir.
 * Storage state is checkpointed on cookie import, session close, shortly after a
 * navigation (a login lands as one), on a timer, and best-effort on shutdown.
 * On session creation, saved state is restored into the new Playwright context
 * via the session:creating hook (mutates contextOptions.storageState).
 *
 * Why the redundancy: the browser profile itself lives in a temp dir
 * (/tmp/playwright_firefoxdev_profile-*), so this JSON file is the ONLY thing
 * that carries a login across a restart. Relying on shutdown alone lost every
 * login -- playwright-core registers its own `process.on('SIGTERM')` handler
 * that closes the browser, so a checkpoint taken from the shutdown hook races a
 * library teardown and dies with "context or browser has been closed". A hard
 * kill (docker kill, OOM, host reboot) never runs shutdown hooks at all. Writes
 * that happen while the browser is demonstrably alive are the ones that survive.
 */

import {
  getUserPersistencePaths,
  loadPersistedStorageState,
  persistStorageState,
} from '../../lib/persistence.js';
import { importBootstrapCookies } from '../../lib/cookies.js';

export async function register(app, ctx, pluginConfig = {}) {
  const { events, config, log } = ctx;

  // Resolve profileDir: env var > plugin config > global config default (~/.camofox/profiles)
  const profileDir = process.env.CAMOFOX_PROFILE_DIR || pluginConfig.profileDir || config.profileDir;
  if (!profileDir) {
    log('warn', 'persistence plugin: no profileDir configured, plugin disabled');
    return;
  }

  const logger = {
    warn: (msg, fields = {}) => log('warn', msg, fields),
  };

  log('info', 'persistence plugin enabled', { profileDir });

  // How long to wait after the last navigation before writing storage state.
  const rawDebounce = process.env.CAMOFOX_CHECKPOINT_DEBOUNCE_MS;
  const debounceMs = rawDebounce === undefined ? 10000 : Math.max(0, parseInt(rawDebounce, 10) || 0);

  // Track active sessions for checkpoint on close
  const activeSessions = new Map(); // userId -> context
  const pendingCheckpoints = new Map(); // userId -> debounce timer
  let intervalTimer = null;

  /**
   * Checkpoint storage state to disk for a userId.
   */
  async function checkpoint(userId, context, reason) {
    if (!context) return;
    const result = await persistStorageState({ profileDir, userId, context, logger });
    if (result.persisted) {
      log('info', 'storage state persisted', { userId, reason, path: result.storageStatePath });
    }
    return result;
  }

  /**
   * Checkpoint a userId once the dust settles. A login walks through several
   * navigations (redirects, consent screens), so debounce instead of writing on
   * every one.
   */
  function scheduleCheckpoint(userId, reason, delayMs) {
    const context = activeSessions.get(userId);
    if (!context) return;
    const existing = pendingCheckpoints.get(userId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      pendingCheckpoints.delete(userId);
      // Re-read the context: the session may have been replaced meanwhile.
      const live = activeSessions.get(userId);
      if (live) checkpoint(userId, live, reason).catch(() => {});
    }, delayMs);
    timer.unref();
    pendingCheckpoints.set(userId, timer);
  }

  // --- Lifecycle hooks ---

  // Before session context is created: inject storageState if we have one saved
  events.on('session:creating', async ({ userId, contextOptions }) => {
    const storageStatePath = await loadPersistedStorageState(profileDir, userId, logger);
    if (storageStatePath) {
      contextOptions.storageState = storageStatePath;
      log('info', 'restoring persisted storage state', { userId, storageStatePath });
    }
  });

  // After session is created: import bootstrap cookies if no persisted state,
  // and track the context for later checkpointing
  events.on('session:created', async ({ userId, context }) => {
    activeSessions.set(userId, context);

    // If no persisted state was restored, try bootstrap cookies
    const existingState = await loadPersistedStorageState(profileDir, userId, logger);
    if (!existingState) {
      const result = await importBootstrapCookies({
        cookiesDir: config.cookiesDir,
        context,
        logger,
      });
      if (result.imported > 0) {
        log('info', 'bootstrap cookies imported', { userId, count: result.imported, source: result.source });
        await checkpoint(userId, context, 'bootstrap_cookies');
      }
    }
  });

  // On cookie import: checkpoint
  events.on('session:cookies:import', async ({ userId }) => {
    const context = activeSessions.get(userId);
    if (context) {
      await checkpoint(userId, context, 'cookie_import');
    }
  });

  // A login ends in a navigation, so a completed navigation is the earliest
  // reliable signal that new cookies exist. This is what actually saves a login
  // made by hand in the noVNC window: it fires while the browser is alive.
  events.on('tab:navigated', ({ userId }) => {
    if (userId) scheduleCheckpoint(userId, 'navigated', debounceMs);
  });

  events.on('tab:created', ({ userId }) => {
    if (userId) scheduleCheckpoint(userId, 'tab_created', debounceMs);
  });

  // On session destroying (pre-close): checkpoint while context is still alive
  events.on('session:destroying', async ({ userId, reason }) => {
    const context = activeSessions.get(userId);
    if (context) {
      await checkpoint(userId, context, reason).catch(() => {});
      activeSessions.delete(userId);
    }
  });

  // On session destroyed (post-close): cleanup tracking if not already done
  events.on('session:destroyed', async ({ userId }) => {
    activeSessions.delete(userId);
  });

  // Flush on the prepare phase, not on server:shutdown: the teardown listeners
  // (the VNC plugin kills the display the browser draws to) run concurrently with
  // any server:shutdown listener, and a storageState() call that loses that race
  // fails with "context or browser has been closed" -- losing every login in the
  // profile. Prepare runs first, while the browser is still up.
  events.on('server:shutdown:prepare', async () => {
    for (const [userId, context] of activeSessions) {
      await checkpoint(userId, context, 'shutdown').catch(() => {});
    }
  });

  events.on('server:shutdown', () => {
    clearInterval(intervalTimer);
    for (const timer of pendingCheckpoints.values()) clearTimeout(timer);
    pendingCheckpoints.clear();
    activeSessions.clear();
  });

  // Periodic checkpoint. Shutdown hooks never run on a hard kill: `docker kill`,
  // an OOM, or a host reboot takes the browser down with the container, and the
  // login a human just made in the shared profile is gone. A small JSON write
  // every minute while a session is open removes that failure mode.
  // CAMOFOX_CHECKPOINT_INTERVAL_MS=0 disables it; CAMOFOX_CHECKPOINT_DEBOUNCE_MS
  // tunes the post-navigation write above.
  const rawInterval = process.env.CAMOFOX_CHECKPOINT_INTERVAL_MS;
  const intervalMs = rawInterval === undefined ? 60000 : parseInt(rawInterval, 10);
  if (intervalMs > 0) {
    intervalTimer = setInterval(() => {
      for (const [userId, context] of activeSessions) {
        checkpoint(userId, context, 'interval').catch(() => {});
      }
    }, intervalMs);
    intervalTimer.unref();
    log('info', 'persistence plugin: periodic checkpoint enabled', { intervalMs });
  }
}
