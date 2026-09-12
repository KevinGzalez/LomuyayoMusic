import { bestCandidate } from '../track-identity.js';

export function createAudiusProvider(env = process.env) {
  const baseUrl = String(env.AUDIUS_API_BASE || 'https://api.audius.co/v1').replace(/\/$/, '');
  const apiKey = String(env.AUDIUS_API_KEY || '').trim();
  const minimumScore = Number(env.AUDIUS_MATCH_MIN_SCORE || 0.74);

  function headers() {
    return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  }

  async function find(identity) {
    const query = [identity.artist, identity.title].filter(Boolean).join(' ');
    if (!query) return null;
    const url = new URL(`${baseUrl}/tracks/search`);
    url.searchParams.set('query', query);
    url.searchParams.set('limit', '10');

    const response = await fetch(url, {
      headers: headers(),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`Audius search HTTP ${response.status}`);
    const payload = await response.json();
    const items = Array.isArray(payload?.data) ? payload.data : [];
    const candidates = items
      .filter((item) => item?.id && !item?.is_stream_gated)
      .map((item) => ({
        provider: 'audius',
        providerId: item.id,
        title: item.title || '',
        artist: item.user?.name || item.user?.handle || '',
        durationMs: Number(item.duration || 0) * 1000,
        raw: item,
      }));

    return bestCandidate(identity, candidates, minimumScore);
  }

  async function fetchAudio(candidate) {
    const url = `${baseUrl}/tracks/${encodeURIComponent(candidate.providerId)}/stream`;
    const response = await fetch(url, {
      headers: headers(),
      redirect: 'follow',
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok || !response.body) throw new Error(`Audius stream HTTP ${response.status}`);
    return response;
  }

  return {
    name: 'audius',
    enabled: String(env.AUDIUS_ENABLED || 'true').toLowerCase() !== 'false',
    find,
    fetchAudio,
    ttlMs: 6 * 3600_000,
    extension: 'mp3',
  };
}
