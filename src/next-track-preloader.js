import { createReadStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createRapidApiAudioProvider } from './rapidapi-audio-provider.js';
import { installQueueSafePlayPatch } from './queue-safe-play.js';

export function createNextTrackPreloader(ytdlpConfig) {
  installQueueSafePlayPatch();

  const rapidApi = createRapidApiAudioProvider();
  const files = new Map();
  const scheduled = new Map();

  if (rapidApi.enabled) {
    console.log(`[Audio] RapidAPI activo (${rapidApi.host}); yt-dlp queda como fallback.`);
  } else {
    console.log('[Audio] RapidAPI desactivado o sin RAPIDAPI_KEY; usando yt-dlp.');
  }

  async function removeFile(path) {
    if (path) await rm(path, { force: true }).catch(() => {});
  }

  function cancelScheduled(guildId) {
    const item = scheduled.get(guildId);
    if (!item) return;
    clearTimeout(item.timer);
    scheduled.delete(guildId);
  }

  function schedule(queue, currentTrack = queue.currentTrack) {
    cancelScheduled(queue.guild.id);
    const nextTrack = queue.tracks.at(0);
    if (!currentTrack || !nextTrack || !rapidApi.enabled) return;

    // Resuelve la URL de la próxima pista a mitad de la canción actual.
    // Así la espera de RapidAPI normalmente desaparece entre canciones.
    const halfway = Math.max(5_000, Math.floor((currentTrack.durationMS || 30_000) / 2));
    const state = { trackId: nextTrack.id, timer: null };
    state.timer = setTimeout(() => {
      rapidApi.preResolve(nextTrack);
      scheduled.delete(queue.guild.id);
    }, halfway);
    state.timer.unref();
    scheduled.set(queue.guild.id, state);
  }

  async function beforeCreateStream(track) {
    // Compatibilidad con cualquier archivo cacheado por versiones anteriores.
    const cached = files.get(track.id);
    if (cached?.path) return createReadStream(cached.path);

    // Proveedor principal: RapidAPI. Si falla, devolvemos null y discord-player
    // continúa con su extractor normal (yt-dlp), que queda como fallback.
    if (rapidApi.enabled) {
      try {
        const stream = await rapidApi.createStream(track);
        if (stream) {
          console.log(`[Audio] Stream RapidAPI: ${track.title}`);
          return stream;
        }
      } catch (error) {
        console.warn(`[RapidAPI] Falló ${track.title}; intentando yt-dlp: ${error.message}`);
      }
    }

    return null;
  }

  async function trackFinished(track) {
    rapidApi.clearTrack(track);
    const path = files.get(track.id)?.path;
    files.delete(track.id);
    await removeFile(path);
  }

  async function clear(guildId) {
    cancelScheduled(guildId);
    const paths = [];
    for (const [trackId, cached] of files) {
      if (cached.guildId !== guildId) continue;
      paths.push(cached.path);
      files.delete(trackId);
    }
    await Promise.all(paths.map(removeFile));
  }

  return {
    schedule,
    beforeCreateStream,
    trackFinished,
    clear,
    audioProvider: rapidApi,
    ytdlpConfig,
  };
}
