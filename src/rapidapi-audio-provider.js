import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

function clean(value) {
  return String(value || '').trim();
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}

function safeTrackId(track) {
  return String(track?.id || 'track').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

export function createRapidApiAudioProvider(env = process.env) {
  const apiKey = clean(env.RAPIDAPI_KEY);
  const host = clean(env.RAPIDAPI_HOST) || 'yt-search-and-download-mp3.p.rapidapi.com';
  const enabled = clean(env.AUDIO_PROVIDER || 'rapidapi').toLowerCase() === 'rapidapi' && Boolean(apiKey);
  const cacheDirectory = resolve(process.cwd(), '.cache', 'rapidapi');

  const resolvedUrls = new Map();
  const urlPending = new Map();
  const preparedFiles = new Map();
  const filePending = new Map();

  async function resolveAudioUrl(track) {
    if (!enabled) return null;
    if (!track?.url || !isHttpUrl(track.url)) return null;
    if (resolvedUrls.has(track.id)) return resolvedUrls.get(track.id);
    if (urlPending.has(track.id)) return urlPending.get(track.id);

    const promise = (async () => {
      const endpoint = new URL(`https://${host}/mp3`);
      endpoint.searchParams.set('url', track.url);

      const response = await fetch(endpoint, {
        headers: {
          accept: 'application/json',
          'x-rapidapi-host': host,
          'x-rapidapi-key': apiKey,
        },
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`RapidAPI respondió HTTP ${response.status}${body ? `: ${body.slice(0, 160)}` : ''}`);
      }

      const data = await response.json();
      if (!data?.success || !isHttpUrl(data.download)) {
        throw new Error(data?.message || data?.error?.message || 'RapidAPI no devolvió una URL de audio válida.');
      }

      resolvedUrls.set(track.id, data.download);
      console.log(`[RapidAPI] URL resuelta: ${track.title}`);
      return data.download;
    })().finally(() => urlPending.delete(track.id));

    urlPending.set(track.id, promise);
    return promise;
  }

  async function prepareFile(track) {
    if (!enabled || !track?.id) return null;

    const cachedPath = preparedFiles.get(track.id);
    if (cachedPath) {
      const info = await stat(cachedPath).catch(() => null);
      if (info?.size) return cachedPath;
      preparedFiles.delete(track.id);
    }

    if (filePending.has(track.id)) return filePending.get(track.id);

    const promise = (async () => {
      await mkdir(cacheDirectory, { recursive: true });
      const id = safeTrackId(track);
      const finalPath = resolve(cacheDirectory, `${id}.mp3`);
      const tempPath = resolve(cacheDirectory, `${id}.${process.pid}.part`);
      const audioUrl = await resolveAudioUrl(track);
      if (!audioUrl) return null;

      const response = await fetch(audioUrl, {
        redirect: 'follow',
        signal: AbortSignal.timeout(120_000),
      });

      if (!response.ok || !response.body) {
        throw new Error(`El servidor de audio respondió HTTP ${response.status}.`);
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.startsWith('audio/') && !contentType.includes('octet-stream')) {
        throw new Error(`Respuesta de audio inesperada: ${contentType || 'sin Content-Type'}.`);
      }

      try {
        await pipeline(Readable.fromWeb(response.body), createWriteStream(tempPath));
        const info = await stat(tempPath);
        if (!info.size) throw new Error('La descarga de audio terminó vacía.');
        await rename(tempPath, finalPath);
      } catch (error) {
        await rm(tempPath, { force: true }).catch(() => {});
        throw error;
      }

      preparedFiles.set(track.id, finalPath);
      console.log(`[RapidAPI] Audio cargado en caché: ${track.title}`);
      return finalPath;
    })().finally(() => filePending.delete(track.id));

    filePending.set(track.id, promise);
    return promise;
  }

  async function createStream(track) {
    const filePath = await prepareFile(track);
    if (!filePath) return null;
    console.log(`[Audio] Reproduciendo desde caché local: ${track.title}`);
    return createReadStream(filePath);
  }

  function preResolve(track) {
    if (!enabled || !track) return Promise.resolve(null);
    return prepareFile(track).catch((error) => {
      console.warn(`[RapidAPI] No pude precargar ${track.title}: ${error.message}`);
      return null;
    });
  }

  async function clearTrack(track) {
    if (!track?.id) return;
    resolvedUrls.delete(track.id);
    urlPending.delete(track.id);
    filePending.delete(track.id);
    const filePath = preparedFiles.get(track.id);
    preparedFiles.delete(track.id);
    if (filePath) await rm(filePath, { force: true }).catch(() => {});
  }

  async function clearAll() {
    resolvedUrls.clear();
    urlPending.clear();
    filePending.clear();
    preparedFiles.clear();
    await rm(cacheDirectory, { recursive: true, force: true }).catch(() => {});
  }

  return {
    enabled,
    host,
    resolveAudioUrl,
    prepareFile,
    createStream,
    preResolve,
    clearTrack,
    clearAll,
  };
}
