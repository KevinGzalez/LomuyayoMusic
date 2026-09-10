import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Realiza una búsqueda de hasta 5 canciones en YouTube usando yt-dlp o el buscador del player.
 * @param {Object} options
 * @param {ReturnType<import('./ytdlp-config.js').createYtDlpConfig>} options.ytdlpConfig
 * @param {string} options.query
 * @param {import('discord-player').Player} options.player
 * @param {import('discord.js').User} options.requestedBy
 * @param {number} [options.limit=5]
 */
export async function searchYouTubeTracks({ ytdlpConfig, query, player, requestedBy, limit = 5 }) {
  const trimmed = String(query || '').trim();
  if (!trimmed) return [];

  // Si es una URL directa, usamos la resolución nativa de discord-player
  if (/^https?:\/\//i.test(trimmed)) {
    const searchResult = await player.search(trimmed, { requestedBy });
    return searchResult?.tracks || [];
  }

  try {
    const { stdout } = await execFileAsync(
      ytdlpConfig.executablePath,
      [
        '--flat-playlist',
        '--dump-single-json',
        '--ignore-errors',
        '--force-ipv4',
        ...ytdlpConfig.commonArgs(),
        `ytsearch${limit}:${trimmed}`,
      ],
      { timeout: 15_000, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
    );

    const data = JSON.parse(stdout);
    const entries = (data.entries ?? []).filter((e) => e?.id && e?.title);

    if (entries.length > 0) {
      return entries.map((entry, index) => ({
        id: entry.id,
        cleanTitle: entry.title,
        title: entry.title,
        author: entry.channel ?? entry.uploader ?? 'YouTube',
        url: `https://www.youtube.com/watch?v=${entry.id}`,
        thumbnail: entry.thumbnail ?? `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg`,
        duration: entry.duration_string ?? formatDuration(entry.duration) ?? '0:00',
        requestedBy,
        index,
      }));
    }
  } catch (error) {
    console.warn('[yt-dlp search fallback]', error.message);
  }

  // Fallback al buscador nativo de discord-player si yt-dlp no devolvió resultados
  const searchResult = await player.search(trimmed, { requestedBy });
  return (searchResult?.tracks || []).slice(0, limit);
}

function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return null;
  const seconds = Math.floor(totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}
