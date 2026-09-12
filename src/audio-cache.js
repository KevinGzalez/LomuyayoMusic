import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

function numberEnv(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function safeKey(key) {
  return String(key || 'track').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 180);
}

export function createAudioCache(env = process.env) {
  const directory = resolve(process.cwd(), env.AUDIO_CACHE_DIR || '.cache/audio');
  const indexPath = resolve(directory, 'index.json');
  const maxBytes = Math.floor(numberEnv(env.AUDIO_CACHE_MAX_MB, 1024) * 1024 * 1024);
  const defaultTtlMs = numberEnv(env.AUDIO_CACHE_TTL_HOURS, 24) * 3600_000;
  const previousGraceMs = numberEnv(env.AUDIO_CACHE_PREVIOUS_GRACE_MINUTES, 5) * 60_000;
  let index = {};
  let loaded = false;
  let saveChain = Promise.resolve();

  async function load() {
    if (loaded) return;
    await mkdir(directory, { recursive: true });
    try {
      index = JSON.parse(await readFile(indexPath, 'utf8')) || {};
    } catch {
      index = {};
    }
    loaded = true;
  }

  function saveIndex() {
    saveChain = saveChain.then(() => writeFile(indexPath, JSON.stringify(index, null, 2), 'utf8')).catch(() => {});
    return saveChain;
  }

  async function get(key) {
    await load();
    const entry = index[key];
    if (!entry?.path) return null;
    const info = await stat(entry.path).catch(() => null);
    if (!info?.size) {
      delete index[key];
      void saveIndex();
      return null;
    }
    const now = Date.now();
    if ((entry.pinnedUntil || 0) <= now && entry.expiresAt && entry.expiresAt < now) {
      await remove(key);
      return null;
    }
    entry.lastAccess = now;
    entry.size = info.size;
    void saveIndex();
    return { ...entry, key };
  }

  async function putFromResponse(key, response, metadata = {}) {
    await load();
    if (!response?.ok || !response.body) throw new Error(`No se pudo descargar audio: HTTP ${response?.status ?? 'desconocido'}`);
    const extension = metadata.extension || 'audio';
    const base = safeKey(key);
    const finalPath = resolve(directory, `${base}.${extension}`);
    const tempPath = resolve(directory, `${base}.${process.pid}.${Date.now()}.part`);

    try {
      await pipeline(Readable.fromWeb(response.body), createWriteStream(tempPath));
      const info = await stat(tempPath);
      if (!info.size) throw new Error('El archivo de audio descargado está vacío.');
      await rename(tempPath, finalPath);
      const now = Date.now();
      index[key] = {
        path: finalPath,
        provider: metadata.provider || 'unknown',
        providerId: metadata.providerId || null,
        score: metadata.score ?? null,
        createdAt: now,
        lastAccess: now,
        expiresAt: now + (metadata.ttlMs || defaultTtlMs),
        pinnedUntil: 0,
        size: info.size,
      };
      await saveIndex();
      await cleanup();
      return { ...index[key], key };
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => {});
      throw error;
    }
  }

  async function remove(key) {
    await load();
    const entry = index[key];
    if (!entry) return;
    delete index[key];
    if (entry.path) await rm(entry.path, { force: true }).catch(() => {});
    await saveIndex();
  }

  async function pin(key, ms = previousGraceMs) {
    await load();
    const entry = index[key];
    if (!entry) return;
    entry.pinnedUntil = Math.max(entry.pinnedUntil || 0, Date.now() + ms);
    await saveIndex();
  }

  async function cleanup() {
    await load();
    const now = Date.now();
    const entries = [];
    let total = 0;

    for (const [key, entry] of Object.entries(index)) {
      const info = entry?.path ? await stat(entry.path).catch(() => null) : null;
      if (!info?.size) {
        delete index[key];
        continue;
      }
      entry.size = info.size;
      total += info.size;
      entries.push([key, entry]);
    }

    for (const [key, entry] of entries) {
      if ((entry.pinnedUntil || 0) > now) continue;
      if (entry.expiresAt && entry.expiresAt < now) {
        total -= entry.size || 0;
        await rm(entry.path, { force: true }).catch(() => {});
        delete index[key];
      }
    }

    if (total > maxBytes) {
      const removable = Object.entries(index)
        .filter(([, entry]) => (entry.pinnedUntil || 0) <= now)
        .sort((a, b) => (a[1].lastAccess || 0) - (b[1].lastAccess || 0));
      for (const [key, entry] of removable) {
        if (total <= maxBytes) break;
        total -= entry.size || 0;
        await rm(entry.path, { force: true }).catch(() => {});
        delete index[key];
      }
    }

    await saveIndex();
  }

  return { directory, get, putFromResponse, remove, pin, cleanup, previousGraceMs };
}
