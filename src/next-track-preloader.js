import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { finished } from 'node:stream/promises';

export function createNextTrackPreloader(ytdlpConfig) {
  const cacheDirectory = resolve(process.cwd(), '.cache', 'next-track');
  const scheduled = new Map();
  const downloads = new Map();
  const files = new Map();

  async function removeFile(path) {
    if (path) await rm(path, { force: true }).catch(() => {});
  }

  function cancelScheduled(guildId) {
    const item = scheduled.get(guildId);
    if (!item) return;
    clearTimeout(item.timer);
    item.child?.kill();
    scheduled.delete(guildId);
  }

  async function download(track, guildId) {
    if (files.has(track.id) || downloads.has(track.id)) return downloads.get(track.id);

    await mkdir(cacheDirectory, { recursive: true });
    const outputPath = resolve(cacheDirectory, `${track.id}.audio`);

    const promise = new Promise((resolveDownload, rejectDownload) => {
      const child = spawn(ytdlpConfig.executablePath, [
        '--quiet',
        '--no-warnings',
        '--no-progress',
        '--no-playlist',
        '--force-ipv4',
        ...ytdlpConfig.commonArgs(),
        '--retries',
        '3',
        '--fragment-retries',
        '3',
        '-f',
        'bestaudio[acodec!=none]/bestaudio/best',
        '-o',
        '-',
        track.url,
      ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

      const state = scheduled.get(guildId);
      if (state?.trackId === track.id) state.child = child;

      const writer = createWriteStream(outputPath);
      let stderr = '';
      child.stdout.pipe(writer);
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.once('error', rejectDownload);
      child.once('close', async (code) => {
        if (code !== 0) {
          await removeFile(outputPath);
          rejectDownload(new Error(stderr.trim() || `yt-dlp terminó con código ${code}`));
          return;
        }

        await finished(writer).catch(() => null);
        const info = await stat(outputPath).catch(() => null);
        if (!info?.size) {
          await removeFile(outputPath);
          rejectDownload(new Error('La precarga terminó vacía.'));
          return;
        }
          files.set(track.id, { path: outputPath, guildId });
        console.log(`[Precarga] Lista: ${track.title}`);
        resolveDownload(outputPath);
      });
    }).finally(() => downloads.delete(track.id));

    downloads.set(track.id, promise);
    return promise;
  }

  function schedule(queue, currentTrack = queue.currentTrack) {
    cancelScheduled(queue.guild.id);
    const nextTrack = queue.tracks.at(0);
    if (!currentTrack || !nextTrack || files.has(nextTrack.id)) return;

    const halfway = Math.max(5_000, Math.floor((currentTrack.durationMS || 30_000) / 2));
    const state = { trackId: nextTrack.id, child: null, timer: null };
    state.timer = setTimeout(() => {
      download(nextTrack, queue.guild.id).catch((error) =>
        console.warn(`[Precarga] No disponible para ${nextTrack.title}: ${error.message}`),
      );
    }, halfway);
    state.timer.unref();
    scheduled.set(queue.guild.id, state);
  }

  async function beforeCreateStream(track) {
    const pending = downloads.get(track.id);
    if (pending) await pending.catch(() => null);
    const cached = files.get(track.id);
    return cached?.path ? createReadStream(cached.path) : null;
  }

  async function trackFinished(track) {
    const path = files.get(track.id)?.path;
    files.delete(track.id);
    await removeFile(path);
  }

  async function clear(guildId) {
    cancelScheduled(guildId);
    const paths = [];
    for (const [trackId, cached] of files) {
      if (cached.guildId !== guildId) continue;
      paths.push(cached.path);
      files.delete(trackId);
    }
    await Promise.all(paths.map(removeFile));
  }

  return { schedule, beforeCreateStream, trackFinished, clear };
}
