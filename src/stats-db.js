import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';

const dataDir = resolve(process.cwd(), 'data');
mkdirSync(dataDir, { recursive: true });

const dbPath = resolve(dataDir, 'music_stats.db');
const db = new DatabaseSync(dbPath);

// Inicializar tablas de la base de datos
db.exec(`
  CREATE TABLE IF NOT EXISTS plays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_tag TEXT NOT NULL,
    song_title TEXT NOT NULL,
    song_author TEXT NOT NULL,
    song_url TEXT,
    duration_ms INTEGER DEFAULT 0,
    played_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS guild_config (
    guild_id TEXT PRIMARY KEY,
    repeat_mode INTEGER DEFAULT 0,
    shuffle_enabled INTEGER DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_plays_guild ON plays(guild_id);
  CREATE INDEX IF NOT EXISTS idx_plays_date ON plays(played_at);
  CREATE INDEX IF NOT EXISTS idx_plays_user ON plays(guild_id, user_id);
`);

/**
 * Convierte strings de duración tipo "3:45" o "1:02:30" o números a milisegundos.
 */
function parseDurationMs(duration, durationMs) {
  if (Number.isInteger(durationMs) && durationMs > 0) return durationMs;
  if (typeof duration === 'number' && duration > 0) return Math.floor(duration);
  if (typeof duration === 'string' && duration.includes(':')) {
    const parts = duration.split(':').map(Number);
    if (parts.length === 2 && !parts.some(Number.isNaN)) {
      return (parts[0] * 60 + parts[1]) * 1000;
    }
    if (parts.length === 3 && !parts.some(Number.isNaN)) {
      return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
    }
  }
  return 0;
}

/**
 * Registra una canción reproducida en el servidor
 */
export function recordPlay({ guildId, userId, userTag, title, author, url, duration, durationMs }) {
  if (!guildId || !title) return;
  try {
    const insertStmt = db.prepare(`
      INSERT INTO plays (guild_id, user_id, user_tag, song_title, song_author, song_url, duration_ms, played_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const calculatedMs = parseDurationMs(duration, durationMs);
    const nowIso = new Date().toISOString();

    insertStmt.run(
      String(guildId),
      String(userId || '0'),
      String(userTag || 'Usuario Desconocido'),
      String(title),
      String(author || 'Desconocido'),
      url ? String(url) : '',
      calculatedMs,
      nowIso,
    );
  } catch (error) {
    console.error('[DB RecordPlay]', error.message);
  }
}

/**
 * Obtiene métricas generales del servidor
 */
export function getGuildStats(guildId) {
  const gId = String(guildId);
  try {
    const totalPlaysRow = db.prepare('SELECT COUNT(*) as count, SUM(duration_ms) as total_duration FROM plays WHERE guild_id = ?').get(gId);
    const topArtistRow = db.prepare('SELECT song_author, COUNT(*) as count FROM plays WHERE guild_id = ? GROUP BY song_author ORDER BY count DESC LIMIT 1').get(gId);
    const topSongRow = db.prepare('SELECT song_title, song_author, COUNT(*) as count FROM plays WHERE guild_id = ? GROUP BY song_title, song_author ORDER BY count DESC LIMIT 1').get(gId);
    const activeUsersRow = db.prepare('SELECT COUNT(DISTINCT user_id) as count FROM plays WHERE guild_id = ?').get(gId);

    return {
      totalPlays: Number(totalPlaysRow?.count ?? 0),
      totalDurationMs: Number(totalPlaysRow?.total_duration ?? 0),
      topArtist: topArtistRow?.song_author ?? 'Sin datos',
      topArtistCount: Number(topArtistRow?.count ?? 0),
      topSong: topSongRow ? `${topSongRow.song_title} — ${topSongRow.song_author}` : 'Sin datos',
      topSongCount: Number(topSongRow?.count ?? 0),
      activeUsersCount: Number(activeUsersRow?.count ?? 0),
    };
  } catch (error) {
    console.error('[DB GetGuildStats]', error.message);
    return {
      totalPlays: 0,
      totalDurationMs: 0,
      topArtist: 'Sin datos',
      topArtistCount: 0,
      topSong: 'Sin datos',
      topSongCount: 0,
      activeUsersCount: 0,
    };
  }
}

/**
 * Top N canciones reproducidas en el servidor
 */
export function getTopSongs(guildId, limit = 10) {
  try {
    const stmt = db.prepare(`
      SELECT song_title, song_author, COUNT(*) as play_count
      FROM plays
      WHERE guild_id = ?
      GROUP BY song_title, song_author
      ORDER BY play_count DESC
      LIMIT ?
    `);
    return stmt.all(String(guildId), limit);
  } catch {
    return [];
  }
}

/**
 * Top N artistas más escuchados en el servidor
 */
export function getTopArtists(guildId, limit = 10) {
  try {
    const stmt = db.prepare(`
      SELECT song_author, COUNT(*) as play_count
      FROM plays
      WHERE guild_id = ?
      GROUP BY song_author
      ORDER BY play_count DESC
      LIMIT ?
    `);
    return stmt.all(String(guildId), limit);
  } catch {
    return [];
  }
}

/**
 * Top N usuarios que más reproducen música
 */
export function getTopUsers(guildId, limit = 10) {
  try {
    const stmt = db.prepare(`
      SELECT user_id, user_tag, COUNT(*) as play_count
      FROM plays
      WHERE guild_id = ?
      GROUP BY user_id, user_tag
      ORDER BY play_count DESC
      LIMIT ?
    `);
    return stmt.all(String(guildId), limit);
  } catch {
    return [];
  }
}

/**
 * Reproducciones agrupadas por los últimos 7 días (Lunes - Domingo)
 */
export function getPlaysByDay(guildId) {
  const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const result = [];
  const now = new Date();

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const dayName = days[d.getDay()];

    try {
      const row = db.prepare(`
        SELECT COUNT(*) as count
        FROM plays
        WHERE guild_id = ? AND date(played_at) = date(?)
      `).get(String(guildId), dateStr);

      result.push({
        date: dateStr,
        label: dayName,
        count: Number(row?.count ?? 0),
      });
    } catch {
      result.push({ date: dateStr, label: dayName, count: 0 });
    }
  }

  return result;
}

/**
 * Reproducciones agrupadas por día/semana/mes según el período solicitado
 */
export function getPlaysOverTime(guildId, period = 'week') {
  if (period === 'day') {
    return getPlaysByDay(guildId);
  }

  if (period === 'month') {
    const result = [];
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      try {
        const row = db.prepare(`
          SELECT COUNT(*) as count
          FROM plays
          WHERE guild_id = ? AND date(played_at) = date(?)
        `).get(String(guildId), dateStr);

        result.push({
          date: dateStr,
          label: `${d.getDate()}/${d.getMonth() + 1}`,
          count: Number(row?.count ?? 0),
        });
      } catch {
        result.push({ date: dateStr, label: `${d.getDate()}/${d.getMonth() + 1}`, count: 0 });
      }
    }
    return result;
  }

  // Por defecto semana (últimas 4 semanas)
  const result = [];
  const now = new Date();
  for (let i = 3; i >= 0; i--) {
    const start = new Date(now);
    start.setDate(start.getDate() - (i * 7 + 6));
    const end = new Date(now);
    end.setDate(end.getDate() - (i * 7));

    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];

    try {
      const row = db.prepare(`
        SELECT COUNT(*) as count
        FROM plays
        WHERE guild_id = ? AND date(played_at) >= date(?) AND date(played_at) <= date(?)
      `).get(String(guildId), startStr, endStr);

      result.push({
        label: `Sem ${4 - i}`,
        count: Number(row?.count ?? 0),
      });
    } catch {
      result.push({ label: `Sem ${4 - i}`, count: 0 });
    }
  }
  return result;
}

/**
 * Obtener la configuración del servidor
 */
export function getGuildConfig(guildId) {
  try {
    const row = db.prepare('SELECT repeat_mode, shuffle_enabled FROM guild_config WHERE guild_id = ?').get(String(guildId));
    return {
      repeatMode: Number(row?.repeat_mode ?? 0),
      shuffleEnabled: Boolean(row?.shuffle_enabled ?? 0),
    };
  } catch {
    return { repeatMode: 0, shuffleEnabled: false };
  }
}

/**
 * Guardar o actualizar la configuración del servidor
 */
export function setGuildConfig(guildId, { repeatMode, shuffleEnabled }) {
  try {
    const stmt = db.prepare(`
      INSERT INTO guild_config (guild_id, repeat_mode, shuffle_enabled)
      VALUES (?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        repeat_mode = excluded.repeat_mode,
        shuffle_enabled = excluded.shuffle_enabled
    `);
    stmt.run(
      String(guildId),
      Number(repeatMode ?? 0),
      shuffleEnabled ? 1 : 0,
    );
  } catch (error) {
    console.error('[DB SetGuildConfig]', error.message);
  }
}
