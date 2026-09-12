import { bestCandidate } from '../track-identity.js';

export function createSoundCloudProvider(env = process.env) {
  const token = String(env.SOUNDCLOUD_ACCESS_TOKEN || '').trim();
  const minimumScore = Number(env.SOUNDCLOUD_MATCH_MIN_SCORE || 0.76);
  const enabled = Boolean(token) && String(env.SOUNDCLOUD_ENABLED || 'true').toLowerCase() !== 'false';

  function headers() {
    return { Authorization: `OAuth ${token}` };
  }

  async function find(identity) {
    if (!enabled) return null;
    const query = [identity.artist, identity.title].filter(Boolean).join(' ');
    const url = new URL('https://api.soundcloud.com/tracks');
    url.searchParams.set('q', query);
    url.searchParams.set('access', 'playable');
    url.searchParams.set('limit', '10');

    const response = await fetch(url, {
      headers: headers(),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`SoundCloud search HTTP ${response.status}`);
    const payload = await response.json();
    const items = Array.isArray(payload) ? payload : Array.isArray(payload?.collection) ? payload.collection : [];
    const candidates = items
      .filter((item) => item?.id && (item.access === 'playable' || item.streamable !== false))
      .map((item) => ({
        provider: 'soundcloud',
        providerId: String(item.id),
        title: item.title || '',
        artist: item.user?.username || '',
        durationMs: Number(item.duration || 0),
        raw: item,
      }));

    return bestCandidate(identity, candidates, minimumScore);
  }

  async function fetchAudio(candidate) {
    const response = await fetch(`https://api.soundcloud.com/tracks/${encodeURIComponent(candidate.providerId)}/stream`, {
      headers: headers(),
      redirect: 'follow',
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok || !response.body) throw new Error(`SoundCloud stream HTTP ${response.status}`);
    return response;
  }

  return {
    name: 'soundcloud',
    enabled,
    find,
    fetchAudio,
    ttlMs: 6 * 3600_000,
    extension: 'mp3',
  };
}
