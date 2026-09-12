import { createReadStream } from 'node:fs';
import { createAudioCache } from './audio-cache.js';
import { createProviderMap } from './provider-map.js';
import { createTrackIdentity } from './track-identity.js';
import { createAudiusProvider } from './providers/audius-provider.js';
import { createJamendoProvider } from './providers/jamendo-provider.js';
import { createRapidApiProvider } from './providers/rapidapi-provider.js';
import { createSpotifyMetadataProvider } from './providers/spotify-metadata.js';

export function createAudioResolver(env = process.env) {
  const cache = createAudioCache(env);
  const providerMap = createProviderMap(env);
  const spotify = createSpotifyMetadataProvider(env);
  const providers = [
    createAudiusProvider(env),
    createJamendoProvider(env),
    createRapidApiProvider(env),
  ].filter((provider) => provider.enabled);
  const pending = new Map();

  console.log(`[AudioResolver] Providers: ${providers.map((p) => p.name).join(' → ') || 'ninguno'}`);
  console.log(`[AudioResolver] Cache persistente: ${cache.directory}`);
  if (spotify.enabled) console.log('[AudioResolver] Spotify metadata matching activo.');

  async function tryProvider(provider, identity) {
    let candidate = await providerMap.get(identity.key, provider.name);
    if (candidate) {
      candidate = { ...candidate, provider: provider.name };
      try {
        const response = await provider.fetchAudio(candidate);
        return { candidate, response, reusedMatch: true };
      } catch (error) {
        console.warn(`[${provider.name}] Match guardado inválido: ${error.message}`);
        await providerMap.remove(identity.key, provider.name);
      }
    }

    candidate = await provider.find(identity);
    if (!candidate) return null;
    const response = await provider.fetchAudio(candidate);
    await providerMap.set(identity.key, provider.name, {
      providerId: candidate.providerId,
      title: candidate.title,
      artist: candidate.artist,
      durationMs: candidate.durationMs,
      score: candidate.score,
      sourceUrl: candidate.sourceUrl || identity.url,
    });
    return { candidate, response, reusedMatch: false };
  }

  async function prepare(track) {
    const identity = createTrackIdentity(track);
    const cached = await cache.get(identity.key);
    if (cached) {
      console.log(`[Cache] HIT ${identity.title} (${cached.provider})`);
      return { path: cached.path, provider: cached.provider, identity, cached: true };
    }
    if (pending.has(identity.key)) return pending.get(identity.key);

    const promise = (async () => {
      const enriched = await spotify.enrich(identity);
      for (const provider of providers) {
        try {
          console.log(`[AudioResolver] Probando ${provider.name}: ${enriched.title}`);
          const resolved = await tryProvider(provider, enriched);
          if (!resolved) continue;
          const entry = await cache.putFromResponse(identity.key, resolved.response, {
            provider: provider.name,
            providerId: resolved.candidate.providerId,
            score: resolved.candidate.score,
            ttlMs: provider.ttlMs,
            extension: provider.extension,
          });
          console.log(`[AudioResolver] ${provider.name} OK (${Math.round((resolved.candidate.score || 1) * 100)}%): ${identity.title}`);
          return { path: entry.path, provider: provider.name, identity: enriched, cached: false };
        } catch (error) {
          console.warn(`[AudioResolver/${provider.name}] ${identity.title}: ${error.message}`);
        }
      }
      throw new Error(`Ningún proveedor pudo entregar audio para ${identity.title}.`);
    })().finally(() => pending.delete(identity.key));

    pending.set(identity.key, promise);
    return promise;
  }

  async function createStream(track) {
    const prepared = await prepare(track);
    await cache.pin(prepared.identity.key, cache.previousGraceMs);
    console.log(`[Audio] Reproduciendo ${track.title} desde ${prepared.provider}${prepared.cached ? ' (cache)' : ''}.`);
    return createReadStream(prepared.path);
  }

  async function prefetch(track) {
    if (!track) return null;
    try {
      const result = await prepare(track);
      await cache.pin(result.identity.key, 30 * 60_000);
      console.log(`[Precarga] Lista desde ${result.provider}: ${track.title}`);
      return result;
    } catch (error) {
      console.warn(`[Precarga] ${track.title}: ${error.message}`);
      return null;
    }
  }

  async function finished(track) {
    const identity = createTrackIdentity(track);
    await cache.pin(identity.key, cache.previousGraceMs);
    void cache.cleanup();
  }

  async function cleanup() {
    await cache.cleanup();
  }

  return { providers, cache, prepare, createStream, prefetch, finished, cleanup };
}
