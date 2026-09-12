function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*(official|video|audio|lyrics?|visualizer)[^)]*\)/gi, ' ')
    .replace(/\[[^\]]*(official|video|audio|lyrics?|visualizer)[^\]]*\]/gi, ' ')
    .replace(/\b(official|music|video|audio|lyrics?|visualizer|hd|4k)\b/gi, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function parseDurationMs(track) {
  if (Number.isFinite(track?.durationMS) && track.durationMS > 0) return track.durationMS;
  const raw = String(track?.duration || '').trim();
  if (!/^\d{1,2}:\d{2}(?::\d{2})?$/.test(raw)) return 0;
  const parts = raw.split(':').map(Number);
  const seconds = parts.length === 3
    ? parts[0] * 3600 + parts[1] * 60 + parts[2]
    : parts[0] * 60 + parts[1];
  return seconds * 1000;
}

export function extractYouTubeId(url) {
  try {
    const parsed = new URL(String(url || ''));
    if (parsed.hostname === 'youtu.be') return parsed.pathname.slice(1).split('/')[0] || null;
    if (parsed.hostname.endsWith('youtube.com')) return parsed.searchParams.get('v');
  } catch {}
  return null;
}

export function createTrackIdentity(track) {
  const title = String(track?.cleanTitle || track?.title || '').trim();
  const artist = String(track?.author || '').trim();
  const youtubeId = extractYouTubeId(track?.url);
  const key = youtubeId ? `youtube:${youtubeId}` : `track:${track?.id || normalizeText(`${artist}-${title}`)}`;

  return {
    key,
    youtubeId,
    title,
    artist,
    normalizedTitle: normalizeText(title),
    normalizedArtist: normalizeText(artist),
    durationMs: parseDurationMs(track),
    url: track?.url || null,
    track,
  };
}

function tokenSet(text) {
  return new Set(normalizeText(text).split(' ').filter(Boolean));
}

function jaccard(a, b) {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

export function scoreCandidate(identity, candidate) {
  const titleScore = jaccard(identity.title, candidate.title);
  const artistScore = identity.artist && candidate.artist ? jaccard(identity.artist, candidate.artist) : 0.5;

  let durationScore = 0.75;
  if (identity.durationMs > 0 && candidate.durationMs > 0) {
    const delta = Math.abs(identity.durationMs - candidate.durationMs);
    durationScore = Math.max(0, 1 - delta / 30_000);
  }

  const exactBoost = normalizeText(identity.title) === normalizeText(candidate.title) ? 0.08 : 0;
  return Math.min(1, titleScore * 0.55 + artistScore * 0.3 + durationScore * 0.15 + exactBoost);
}

export function bestCandidate(identity, candidates, minimumScore = 0.72) {
  const ranked = (candidates || [])
    .map((candidate) => ({ ...candidate, score: scoreCandidate(identity, candidate) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0] || null;
  return best && best.score >= minimumScore ? best : null;
}
