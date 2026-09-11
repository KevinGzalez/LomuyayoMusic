import { Player } from 'discord-player';

const PATCH_FLAG = Symbol.for('lomuyayo.queueSafePlayInstalled');
const guildLocks = new Map();

function resolveGuildId(channel) {
  return channel?.guild?.id || channel?.guildId || channel?.guild_id || null;
}

async function enqueueIntoExistingQueue(player, queue, query, options) {
  let result = query;

  if (typeof query === 'string') {
    result = await player.search(query, {
      requestedBy: options?.requestedBy,
    });
  }

  const playlist = result?.playlist ?? null;
  const tracks = Array.isArray(result?.tracks)
    ? result.tracks
    : Array.isArray(result)
      ? result
      : result?.id
        ? [result]
        : [];

  if (playlist) {
    queue.addTrack(playlist);
  } else if (tracks.length > 0) {
    queue.addTrack(tracks.length === 1 ? tracks[0] : tracks);
  } else {
    throw new Error('No se encontraron pistas para añadir a la cola.');
  }

  const firstTrack = tracks[0] ?? playlist?.tracks?.[0] ?? null;
  console.log(`[Queue] ${tracks.length || playlist?.tracks?.length || 1} pista(s) añadida(s) sin interrumpir la reproducción actual.`);

  return {
    queue,
    track: firstTrack,
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
        const hasActiveTrack = Boolean(existingQueue?.currentTrack) || existingQueue?.isPlaying?.() || existingQueue?.node?.isPlaying?.();

        if (existingQueue && hasActiveTrack) {
          return enqueueIntoExistingQueue(this, existingQueue, query, options);
        }

        return originalPlay.call(this, channel, query, options);
      });

    guildLocks.set(guildId, task);

    try {
      return await task;
    } finally {
      if (guildLocks.get(guildId) === task) guildLocks.delete(guildId);
    }
  };

  console.log('[Queue] Protección FIFO activada: nuevas canciones se encolan sin cortar la actual.');
}
