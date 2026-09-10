import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { QueryType, Track } from 'discord-player';

const execFileAsync = promisify(execFile);

export function isYouTubeMix(query) {
  try {
    const url = new URL(query);
    const listId = url.searchParams.get('list');
    return ['youtube.com', 'www.youtube.com', 'music.youtube.com'].includes(url.hostname)
      && Boolean(url.searchParams.get('v'))
      && Boolean(listId?.startsWith('RD'));
  } catch {
    return false;
  }
}

export async function expandYouTubeMix({ player, extractor, ytdlpConfig, query, requestedBy, onTrackHydrated }) {
  const { stdout } = await execFileAsync(ytdlpConfig.executablePath, [
    '--flat-playlist',
    '--dump-single-json',
    '--ignore-errors',
    '--playlist-end',
    '50',
    '--force-ipv4',
    ...ytdlpConfig.commonArgs(),
    query,
  ], { timeout: 120_000, maxBuffer: 50 * 1024 * 1024, windowsHide: true });

  const data = JSON.parse(stdout);
  const entries = (data.entries ?? []).filter((entry) => entry?.id && entry?.title);
  if (!entries.length) throw new Error('YouTube no devolvió canciones para este mix.');

  const tracks = entries.map((entry) => {
    const track = new Track(player, {
      title: entry.title,
      description: entry.description ?? '',
      author: entry.channel ?? entry.uploader ?? 'YouTube',
      url: `https://www.youtube.com/watch?v=${entry.id}`,
      thumbnail: entry.thumbnail ?? `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg`,
      duration: entry.duration_string ?? formatDuration(entry.duration) ?? '0:00',
      views: entry.view_count ?? 0,
      requestedBy,
      source: 'youtube',
      queryType: QueryType.YOUTUBE_PLAYLIST,
      raw: entry,
    });
    track.extractor = extractor;
    return track;
  });

  const playlist = player.createPlaylist({
    tracks,
    title: data.title ?? 'Mix de YouTube',
    description: data.description ?? '',
    thumbnail: data.thumbnail ?? tracks[0].thumbnail,
    type: 'playlist',
    source: 'youtube',
    author: { name: data.uploader ?? 'YouTube', url: data.uploader_url ?? query },
    id: data.id ?? new URL(query).searchParams.get('list'),
    url: query,
    rawPlaylist: data,
  });

  for (const track of tracks) track.playlist = playlist;

  // Los mixes suelen omitir la duración en su listado plano. La completamos
  // en segundo plano por lotes pequeños para no retrasar el inicio del audio.
  void hydrateDurations(tracks, extractor, requestedBy, onTrackHydrated).catch((error) =>
    console.warn(`[Duraciones] No se pudieron completar todas: ${error.message}`),
  );

  return playlist;
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

async function hydrateDurations(tracks, extractor, requestedBy, onTrackHydrated) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(5, tracks.length) }, async () => {
    while (cursor < tracks.length) {
      const index = cursor++;
      const track = tracks[index];
      if (track.duration && track.duration !== '0:00') continue;

      try {
        const result = await extractor.handle(track.url, {
          type: QueryType.YOUTUBE_VIDEO,
          requestedBy,
        });
        const resolved = result.tracks?.[0];
        if (!resolved?.duration || resolved.duration === '0:00') continue;

        track.duration = resolved.duration;
        if (resolved.thumbnail) track.thumbnail = resolved.thumbnail;
        if (resolved.author) track.author = resolved.author;
        onTrackHydrated?.(track);
      } catch (error) {
        console.warn(`[Duraciones] ${track.title}: ${error.message}`);
      }
    }
  });

  await Promise.all(workers);
  console.log(`[Duraciones] Metadatos completados para el mix (${tracks.length} pistas).`);
}
