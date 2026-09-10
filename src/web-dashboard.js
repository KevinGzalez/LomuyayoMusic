import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
import { getGuildStats, getPlaysByDay, getTopArtists, getTopSongs, getTopUsers } from './stats-db.js';

const MIME = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

function trackJson(track) {
  if (!track) return null;
  return {
    id: track.id,
    title: track.cleanTitle ?? track.title,
    author: track.author,
    duration: track.duration,
    durationMs: track.durationMS || 0,
    thumbnail: track.thumbnail,
    url: track.url,
    requestedBy: track.requestedBy?.username ?? null,
  };
}

async function readBody(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 16_384) throw new Error('Solicitud demasiado grande.');
  }
  return raw ? JSON.parse(raw) : {};
}

export function startWebDashboard({ client, player, sleepTimer, onStop }) {
  const host = process.env.WEB_HOST || '127.0.0.1';
  const port = Number.parseInt(process.env.WEB_PORT || '8787', 10);
  const token = process.env.WEB_DASHBOARD_TOKEN || '';
  const publicDir = resolve(process.cwd(), 'src', 'web');

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      if (url.pathname === '/api/guilds' && request.method === 'GET') {
        const guilds = client.guilds.cache.map((guild) => ({ id: guild.id, name: guild.name, active: Boolean(player.nodes.get(guild.id)) }));
        return json(response, 200, { guilds });
      }

      const stateMatch = url.pathname.match(/^\/api\/guild\/([^/]+)$/);
      if (stateMatch && request.method === 'GET') {
        const guildId = stateMatch[1];
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return json(response, 404, { error: 'Servidor no encontrado.' });
        const queue = player.nodes.get(guildId);
        let progressMs = 0;
        try { progressMs = queue?.node.getTimestamp()?.current?.value || 0; } catch {}
        return json(response, 200, {
          guild: { id: guild.id, name: guild.name, icon: guild.iconURL() },
          player: {
            active: Boolean(queue?.currentTrack),
            paused: queue?.node.isPaused() ?? false,
            channel: queue?.channel?.name ?? null,
            repeatMode: queue?.repeatMode ?? 0,
            progressMs,
            current: trackJson(queue?.currentTrack),
            queue: queue?.tracks.toArray().slice(0, 50).map(trackJson) ?? [],
          },
          sleep: sleepTimer.get(guildId),
          stats: {
            summary: getGuildStats(guildId),
            days: getPlaysByDay(guildId),
            artists: getTopArtists(guildId, 5),
            songs: getTopSongs(guildId, 5),
            users: getTopUsers(guildId, 5),
          },
        });
      }

      const controlMatch = url.pathname.match(/^\/api\/guild\/([^/]+)\/control$/);
      if (controlMatch && request.method === 'POST') {
        if (token && request.headers.authorization !== `Bearer ${token}`) return json(response, 401, { error: 'Clave incorrecta.' });
        const guildId = controlMatch[1];
        const queue = player.nodes.get(guildId);
        const body = await readBody(request);
        if (body.action === 'sleep-cancel') {
          sleepTimer.cancel(guildId);
          return json(response, 200, { ok: true });
        }
        if (!queue?.currentTrack) return json(response, 409, { error: 'No hay reproducción activa.' });
        if (body.action === 'previous') {
          if (queue.history.previousTrack) await queue.history.previous(true);
          else await queue.node.seek(0);
        } else if (body.action === 'pause') queue.node.pause();
        else if (body.action === 'resume') queue.node.resume();
        else if (body.action === 'skip') queue.node.skip();
        else if (body.action === 'stop') await onStop(guildId, '⏹️ Reproducción detenida desde el dashboard web.');
        else if (body.action === 'sleep-track') sleepTimer.setEndOfTrack(guildId, queue.currentTrack.id, 'Dashboard web');
        else if (body.action === 'sleep-minutes') sleepTimer.setMinutes(guildId, Number(body.minutes), 'Dashboard web');
        else return json(response, 400, { error: 'Acción desconocida.' });
        return json(response, 200, { ok: true, sleep: sleepTimer.get(guildId) });
      }

      const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const filePath = resolve(publicDir, relative);
      if (!filePath.startsWith(`${publicDir}\\`) && filePath !== resolve(publicDir, 'index.html')) return json(response, 403, { error: 'Ruta no permitida.' });
      if (!existsSync(filePath)) return json(response, 404, { error: 'No encontrado.' });
      response.writeHead(200, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream' });
      createReadStream(filePath).pipe(response);
    } catch (error) {
      json(response, 500, { error: error.message || 'Error interno.' });
    }
  });

  server.on('error', (error) => console.error('[Dashboard Web]', error.message));
  server.listen(port, host, () => console.log(`🌙 Dashboard web: http://${host}:${port}`));
  return server;
}
