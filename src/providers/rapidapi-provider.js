export function createRapidApiProvider(env = process.env) {
  const apiKey = String(env.RAPIDAPI_KEY || '').trim();
  const host = String(env.RAPIDAPI_HOST || 'yt-search-and-download-mp3.p.rapidapi.com').trim();
  const enabled = Boolean(apiKey) && String(env.RAPIDAPI_ENABLED || 'true').toLowerCase() !== 'false';

  async function find(identity) {
    if (!enabled || !identity.url) return null;
    return {
      provider: 'rapidapi',
      providerId: identity.youtubeId || identity.key,
      title: identity.title,
      artist: identity.artist,
      durationMs: identity.durationMs,
      score: 1,
      sourceUrl: identity.url,
    };
  }

  async function fetchAudio(candidate) {
    const endpoint = new URL(`https://${host}/mp3`);
    endpoint.searchParams.set('url', candidate.sourceUrl);
    const response = await fetch(endpoint, {
      headers: {
        accept: 'application/json',
        'x-rapidapi-host': host,
        'x-rapidapi-key': apiKey,
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`RapidAPI HTTP ${response.status}${body ? `: ${body.slice(0, 120)}` : ''}`);
    }
    const payload = await response.json();
    if (!payload?.success || !/^https?:\/\//i.test(payload.download || '')) {
      throw new Error(payload?.message || 'RapidAPI no devolvió una URL de descarga válida.');
    }
    const audio = await fetch(payload.download, {
      redirect: 'follow',
      signal: AbortSignal.timeout(120_000),
    });
    if (!audio.ok || !audio.body) throw new Error(`RapidAPI audio HTTP ${audio.status}`);
    return audio;
  }

  return {
    name: 'rapidapi',
    enabled,
    find,
    fetchAudio,
    ttlMs: 24 * 3600_000,
    extension: 'mp3',
  };
}
