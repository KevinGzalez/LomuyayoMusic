import { createAudioResolver } from './audio-resolver.js';
import { installQueueSafePlayPatch } from './queue-safe-play.js';

export function createNextTrackPreloader(ytdlpConfig) {
  installQueueSafePlayPatch();

  const resolver = createAudioResolver();
  const scheduled = new Map();

  function cancelScheduled(guildId) {
    const item = scheduled.get(guildId);
    if (!item) return;
    clearTimeout(item.timer);
    scheduled.delete(guildId);
  }

  function schedule(queue, currentTrack = queue.currentTrack) {
    cancelScheduled(queue.guild.id);
    const nextTrack = queue.tracks.at(0);
    if (!currentTrack || !nextTrack) return;

    // Precargamos una sola pista: ahorra cuota y evita descargar playlists enteras.
    const duration = currentTrack.durationMS || 30_000;
    const delay = Math.max(5_000, Math.min(30_000, Math.floor(duration / 2)));
    const state = { trackId: nextTrack.id, timer: null };
    state.timer = setTimeout(() => {
      console.log(`[Precarga] Preparando próxima pista sin reproducir: ${nextTrack.title}`);
      resolver.prefetch(nextTrack);
      scheduled.delete(queue.guild.id);
    }, delay);
    state.timer.unref();
    scheduled.set(queue.guild.id, state);
  }

  async function beforeCreateStream(track) {
    try {
      return await resolver.createStream(track);
    } catch (error) {
      console.warn(`[AudioResolver] ${track.title}: ${error.message}; intentando yt-dlp como último fallback.`);
      return null;
    }
  }

  async function trackFinished(track) {
    await resolver.finished(track).catch(() => {});
  }

  async function clear(guildId) {
    cancelScheduled(guildId);
    // No vaciamos la caché persistente al salir del canal. TTL/LRU la gestiona.
    await resolver.cleanup().catch(() => {});
  }

  return {
    schedule,
    beforeCreateStream,
    trackFinished,
    clear,
    audioProvider: resolver,
    ytdlpConfig,
  };
}
