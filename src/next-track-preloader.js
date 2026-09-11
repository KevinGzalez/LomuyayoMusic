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
    console.log('[Audio] Modo caché local activo: la siguiente canción se descarga sin reproducirse.');
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

    const halfway = Math.max(5_000, Math.floor((currentTrack.durationMS || 30_000) / 2));
    const state = { trackId: nextTrack.id, timer: null };
    state.timer = setTimeout(() => {
      console.log(`[Precarga] Descargando siguiente pista sin reproducir: ${nextTrack.title}`);
      rapidApi.preResolve(nextTrack);
      scheduled.delete(queue.guild.id);
    }, halfway);
    state.timer.unref();
    scheduled.set(queue.guild.id, state);
  }

  async function beforeCreateStream(track) {
    const cached = files.get(track.id);
    if (cached?.path) return createReadStream(cached.path);

    if (rapidApi.enabled) {
      try {
        const stream = await rapidApi.createStream(track);
        if (stream) return stream;
      } catch (error) {
        console.warn(`[RapidAPI] Falló ${track.title}; intentando yt-dlp: ${error.message}`);
      }
    }

    return null;
  }

  async function trackFinished(track) {
    await rapidApi.clearTrack(track);
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
