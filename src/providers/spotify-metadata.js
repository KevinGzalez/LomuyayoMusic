import { bestCandidate } from '../track-identity.js';

export function createSpotifyMetadataProvider(env = process.env) {
  const clientId = String(env.SPOTIFY_CLIENT_ID || '').trim();
  const clientSecret = String(env.SPOTIFY_CLIENT_SECRET || '').trim();
  const market = String(env.SPOTIFY_MARKET || 'DO').trim();
  const enabled = Boolean(clientId && clientSecret) && String(env.SPOTIFY_METADATA_ENABLED || 'true').toLowerCase() !== 'false';
  let token = null;
  let tokenExpiresAt = 0;

  async function getToken() {
    if (!enabled) return null;
    if (token && Date.now() < tokenExpiresAt - 60_000) return token;
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Spotify token HTTP ${response.status}`);
    const payload = await response.json();
    token = payload.access_token;
    tokenExpiresAt = Date.now() + Number(payload.expires_in || 3600) * 1000;
    return token;
  }

  async function enrich(identity) {
    if (!enabled || !identity.title) return identity;
    try {
      const accessToken = await getToken();
      const query = [identity.title ? `track:${identity.title}` : '', identity.artist ? `artist:${identity.artist}` : '']
        .filter(Boolean)
        .join(' ');
      const url = new URL('https://api.spotify.com/v1/search');
      url.searchParams.set('q', query);
      url.searchParams.set('type', 'track');
      url.searchParams.set('limit', '5');
      url.searchParams.set('market', market);
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`Spotify search HTTP ${response.status}`);
      const payload = await response.json();
      const candidates = (payload?.tracks?.items || []).map((item) => ({
        provider: 'spotify',
        providerId: item.id,
        title: item.name || '',
        artist: (item.artists || []).map((artist) => artist.name).join(', '),
        durationMs: Number(item.duration_ms || 0),
        isrc: item.external_ids?.isrc || null,
        raw: item,
      }));
      const best = bestCandidate(identity, candidates, 0.78);
      if (!best) return identity;
      return {
        ...identity,
        spotify: {
          id: best.providerId,
          isrc: best.isrc,
          score: best.score,
          title: best.title,
          artist: best.artist,
        },
      };
    } catch (error) {
      console.warn(`[Spotify metadata] ${error.message}`);
      return identity;
    }
  }

  return { enabled, enrich };
}
