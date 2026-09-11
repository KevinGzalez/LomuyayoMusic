import { Readable } from 'node:stream';

function clean(value) {
  return String(value || '').trim();
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}

export function createRapidApiAudioProvider(env = process.env) {
  const apiKey = clean(env.RAPIDAPI_KEY);
  const host = clean(env.RAPIDAPI_HOST) || 'yt-search-and-download-mp3.p.rapidapi.com';
  const enabled = clean(env.AUDIO_PROVIDER || 'rapidapi').toLowerCase() === 'rapidapi' && Boolean(apiKey);
  const resolvedUrls = new Map();
  const pending = new Map();

  async function resolveAudioUrl(track) {
    if (!enabled) return null;
    if (!track?.url || !isHttpUrl(track.url)) return null;
    if (resolvedUrls.has(track.id)) return resolvedUrls.get(track.id);
    if (pending.has(track.id)) return pending.get(track.id);

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
      console.log(`[RapidAPI] Audio resuelto: ${track.title}`);
      return data.download;
    })().finally(() => pending.delete(track.id));

    pending.set(track.id, promise);
    return promise;
  }

  async function createStream(track) {
    const audioUrl = await resolveAudioUrl(track);
    if (!audioUrl) return null;

    const response = await fetch(audioUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok || !response.body) {
      throw new Error(`El servidor de audio respondió HTTP ${response.status}.`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('audio/') && !contentType.includes('octet-stream')) {
      throw new Error(`Respuesta de audio inesperada: ${contentType || 'sin Content-Type'}.`);
    }

    return Readable.fromWeb(response.body);
  }

  function preResolve(track) {
    if (!enabled || !track) return Promise.resolve(null);
    return resolveAudioUrl(track).catch((error) => {
      console.warn(`[RapidAPI] No pude precargar ${track.title}: ${error.message}`);
      return null;
    });
  }

  function clearTrack(track) {
    if (track?.id) {
      resolvedUrls.delete(track.id);
      pending.delete(track.id);
    }
  }

  function clearAll() {
    resolvedUrls.clear();
    pending.clear();
  }

  return {
    enabled,
    host,
    resolveAudioUrl,
    createStream,
    preResolve,
    clearTrack,
    clearAll,
  };
}
