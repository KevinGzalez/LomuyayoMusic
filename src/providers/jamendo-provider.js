import { bestCandidate } from '../track-identity.js';

export function createJamendoProvider(env = process.env) {
  const clientId = String(env.JAMENDO_CLIENT_ID || '').trim();
  const enabled = Boolean(clientId) && String(env.JAMENDO_ENABLED || 'true').toLowerCase() !== 'false';
  const minimumScore = Number(env.JAMENDO_MATCH_MIN_SCORE || 0.82);
  const baseUrl = String(env.JAMENDO_API_BASE || 'https://api.jamendo.com/v3.0').replace(/\/$/, '');

  async function find(identity) {
    if (!enabled) return null;
    const query = [identity.artist, identity.title].filter(Boolean).join(' ');
    if (!query) return null;

    const url = new URL(`${baseUrl}/tracks/`);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '20');
    url.searchParams.set('search', query);
    url.searchParams.set('audioformat', 'mp32');
    url.searchParams.set('type', 'single albumtrack');

    const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`Jamendo search HTTP ${response.status}`);
    const payload = await response.json();
    if (payload?.headers?.status !== 'success') {
      throw new Error(payload?.headers?.error_message || 'Jamendo devolvió una respuesta inválida.');
    }

    const items = Array.isArray(payload?.results) ? payload.results : [];
    const candidates = items
      .filter((item) => item?.id && /^https?:\/\//i.test(item?.audio || ''))
      .map((item) => ({
        provider: 'jamendo',
        providerId: String(item.id),
        title: item.name || '',
        artist: item.artist_name || '',
        durationMs: Number(item.duration || 0) * 1000,
        sourceUrl: item.audio,
        raw: item,
      }));

    return bestCandidate(identity, candidates, minimumScore);
  }

  async function fetchAudio(candidate) {
    if (!candidate?.providerId) throw new Error('Jamendo candidate sin providerId.');

    // Usamos /tracks/file?action=stream para que Jamendo entregue el recurso de audio
    // mediante redirect. No dependemos de que la URL "audio" guardada siga vigente.
    const url = new URL(`${baseUrl}/tracks/file/`);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('id', candidate.providerId);
    url.searchParams.set('audioformat', 'mp32');
    url.searchParams.set('action', 'stream');

    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok || !response.body) throw new Error(`Jamendo stream HTTP ${response.status}`);
    return response;
  }

  return {
    name: 'jamendo',
    enabled,
    find,
    fetchAudio,
    ttlMs: 12 * 3600_000,
    extension: 'mp3',
  };
}
