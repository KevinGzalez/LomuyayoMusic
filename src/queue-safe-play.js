import { Player } from 'discord-player';

const PATCH_FLAG = Symbol.for('lomuyayo.queueSafePlayInstalled');
const guildLocks = new Map();

function resolveGuildId(channel) {
  return channel?.guild?.id || channel?.guildId || channel?.guild_id || null;
}

function queueHasPlayback(queue) {
  if (!queue) return false;

  const currentTrack = queue.currentTrack || queue.current || queue.node?.currentTrack || null;
  if (currentTrack) return true;

  try {
    if (queue.isPlaying?.()) return true;
  } catch {}

  try {
    if (queue.node?.isPlaying?.()) return true;
  } catch {}

  try {
    if (queue.node?.isPaused?.()) return true;
  } catch {}

  return false;
}

async function normalizeTracks(player, query, options) {
  let result = query;

  if (typeof query === 'string') {
    result = await player.search(query, {
      requestedBy: options?.requestedBy,
    });
  }

  if (Array.isArray(result)) {
    return { result, playlist: null, tracks: result.filter(Boolean) };
  }

  if (result?.playlist?.tracks?.length) {
    return {
      result,
      playlist: result.playlist,
      tracks: result.playlist.tracks.filter(Boolean),
    };
  }

  if (Array.isArray(result?.tracks) && result.tracks.length) {
    return {
      result,
      playlist: result.playlist ?? null,
      tracks: result.tracks.filter(Boolean),
    };
  }

  if (result?.id) {
    return { result, playlist: null, tracks: [result] };
  }

  return { result, playlist: null, tracks: [] };
}

async function enqueueIntoExistingQueue(player, queue, query, options) {
  const { result, playlist, tracks } = await normalizeTracks(player, query, options);

  if (!tracks.length) {
    throw new Error('No se encontraron pistas para añadir a la cola.');
  }

  // IMPORTANTE: añadimos las pistas explícitamente, no el objeto Playlist.
  // Con algunos flujos de discord-player, queue.addTrack(playlist) puede provocar
  // que se trate la colección como una reproducción nueva en vez de solo encolarla.
  queue.addTrack(tracks);

  const firstTrack = tracks[0];
  console.log(`[Queue] ${tracks.length} pista(s) añadida(s) al final de la cola. La actual sigue sonando.`);

  return {
    queue,
    track: firstTrack,
    playlist,
    searchResult: result,
  };
}

export function installQueueSafePlayPatch() {
  if (Player.prototype[PATCH_FLAG]) return;

  const originalPlay = Player.prototype.play;

  Object.defineProperty(Player.prototype, PATCH_FLAG, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: true,
  });

  Player.prototype.play = async function queueSafePlay(channel, query, options = {}) {
    const guildId = resolveGuildId(channel);
    if (!guildId) return originalPlay.call(this, channel, query, options);

    const previous = guildLocks.get(guildId) || Promise.resolve();

    const task = previous
      .catch(() => {})
      .then(async () => {
        const existingQueue = this.nodes.get(guildId);

        if (existingQueue && queueHasPlayback(existingQueue)) {
          return enqueueIntoExistingQueue(this, existingQueue, query, options);
        }

        // Solo usamos Player.play para arrancar cuando realmente no hay pista activa.
        return originalPlay.call(this, channel, query, options);
      });

    guildLocks.set(guildId, task);

    try {
      return await task;
    } finally {
      if (guildLocks.get(guildId) === task) guildLocks.delete(guildId);
    }
  };

  console.log('[Queue] Protección FIFO v2 activada: solo la primera solicitud inicia reproducción; las demás se encolan.');
}
