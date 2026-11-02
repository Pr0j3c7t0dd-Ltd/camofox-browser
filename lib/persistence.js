import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

function getUserPersistencePaths(profileDir, userId) {
  const rootDir = path.resolve(profileDir);
  const safeUserDir = crypto
    .createHash('sha256')
    .update(String(userId))
    .digest('hex')
    .slice(0, 32);

  const userDir = path.join(rootDir, safeUserDir);
  return {
    rootDir,
    userDir,
    storageStatePath: path.join(userDir, 'storage-state.json'),
    metaPath: path.join(userDir, 'meta.json'),
  };
}

async function loadPersistedStorageState(profileDir, userId, logger = console) {
  if (!profileDir) return undefined;

  const { storageStatePath } = getUserPersistencePaths(profileDir, userId);

  try {
    const raw = await fs.readFile(storageStatePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return undefined;
    if (!Array.isArray(parsed.cookies)) return undefined;
    if (parsed.origins !== undefined && !Array.isArray(parsed.origins)) return undefined;
    return storageStatePath;
  } catch (err) {
    if (err?.code === 'ENOENT') return undefined;
    logger?.warn?.('failed to load persisted storage state', {
      userId: String(userId),
      storageStatePath,
      error: err?.message || String(err),
    });
    return undefined;
  }
}

/**
 * Build a Playwright storage-state object without asking the browser for one.
 *
 * `context.storageState()` makes Firefox/Juggler map a real window to read the
 * per-origin storage, and in a headed browser on a VNC display that window is
 * visible: it flashes on screen for a second or two. On a one-minute checkpoint
 * timer that reads as "the page keeps reloading / something is polling", so the
 * writes that have to be frequent collect the same data directly instead:
 * cookies from `context.cookies()`, and localStorage from the pages that are
 * already open -- which is exactly where a human logged in.
 */
async function captureStorageState(context) {
  const cookies = await context.cookies();
  const origins = [];
  const seen = new Set();

  for (const page of context.pages()) {
    if (page.isClosed()) continue;
    let origin;
    try {
      const url = page.url();
      if (!/^https?:/.test(url)) continue;
      origin = new URL(url).origin;
    } catch {
      continue;
    }
    if (seen.has(origin)) continue;
    seen.add(origin);
    try {
      const items = await page.evaluate(() =>
        Object.entries(window.localStorage).map(([name, value]) => ({ name, value }))
      );
      if (items.length) origins.push({ origin, localStorage: items });
    } catch {
      // A page mid-navigation has no execution context; cookies still land.
    }
  }

  return { cookies, origins };
}

async function persistStorageState({ profileDir, userId, context, logger = console, windowless = false }) {
  if (!profileDir || !context) {
    return { persisted: false, reason: 'disabled' };
  }

  const { userDir, storageStatePath, metaPath } = getUserPersistencePaths(profileDir, userId);
  const suffix = `.tmp-${process.pid}-${Date.now()}`;
  const tmpStoragePath = `${storageStatePath}${suffix}`;
  const tmpMetaPath = `${metaPath}${suffix}`;

  try {
    await fs.mkdir(userDir, { recursive: true });
    if (windowless) {
      const state = await captureStorageState(context);
      await fs.writeFile(tmpStoragePath, JSON.stringify(state));
    } else {
      await context.storageState({ path: tmpStoragePath });
    }
    await fs.rename(tmpStoragePath, storageStatePath);
    await fs.writeFile(
      tmpMetaPath,
      JSON.stringify(
        {
          userId: String(userId),
          updatedAt: new Date().toISOString(),
          storageStatePath,
        },
        null,
        2
      )
    );
    await fs.rename(tmpMetaPath, metaPath);
    return { persisted: true, userDir, storageStatePath, metaPath };
  } catch (err) {
    await fs.unlink(tmpStoragePath).catch(() => {});
    await fs.unlink(tmpMetaPath).catch(() => {});
    logger?.warn?.('failed to persist storage state', {
      userId: String(userId),
      storageStatePath,
      error: err?.message || String(err),
    });
    return { persisted: false, reason: 'error', error: err };
  }
}

export {
  getUserPersistencePaths,
  loadPersistedStorageState,
  persistStorageState,
  captureStorageState,
};
