import 'dotenv/config';
import { createServer } from 'node:net';
import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { Player, QueueRepeatMode } from 'discord-player';
import { DefaultExtractors } from '@discord-player/extractor';
import {
  setFFmpegPath,
  setYtDlpPath,
  YouTubeDlpExtractor,
} from 'discord-player-youtubedlp';
import ffmpegPath from 'ffmpeg-static';
import { getVoiceContext } from './commands.js';
import {
  configPanelPayload,
  createSearchModal,
  disablePlayerPanel,
  isPlayerButton,
  mainPanelPayload,
  playerButtonAction,
  queuePanelPayload,
  searchResultsPayload,
  statsPanelPayload,
  updatePlayerPanel,
} from './player-panel.js';
import { createNextTrackPreloader } from './next-track-preloader.js';
import { recordPlay, setGuildConfig } from './stats-db.js';
import { expandYouTubeMix, isYouTubeMix } from './youtube-mix.js';
import { searchYouTubeTracks } from './youtube-search.js';
import { createSleepTimer } from './sleep-timer.js';
import { startWebDashboard } from './web-dashboard.js';
import { createYtDlpConfig } from './ytdlp-config.js';

const { DISCORD_BOT_TOKEN, CLIENT_ID } = process.env;
if (!DISCORD_BOT_TOKEN) {
  console.error('Falta DISCORD_BOT_TOKEN. Copia .env.example como .env y complétalo.');
  process.exit(1);
}

// Evita que dos terminales ejecuten el mismo bot y compitan por las interacciones/voz.
const lockPort = 31_000 + Number(BigInt(CLIENT_ID || '0') % 1_000n);
const instanceLock = createServer();
try {
  await new Promise((resolveLock, rejectLock) => {
    instanceLock.once('error', rejectLock);
    instanceLock.listen(lockPort, '127.0.0.1', resolveLock);
  });
} catch (error) {
  if (error.code === 'EADDRINUSE') {
    console.error('❌ LomuyayoMusic ya está ejecutándose en otra terminal. Cierra la instancia anterior primero.');
    process.exit(1);
  }
  throw error;
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

const player = new Player(client);
client.player = player;

const processedInteractions = new Set();
const userSearchResultsCache = new Map();

function acceptInteraction(interactionId) {
  if (processedInteractions.has(interactionId)) return false;
  processedInteractions.add(interactionId);

  const cleanup = setTimeout(() => processedInteractions.delete(interactionId), 15 * 60_000);
  cleanup.unref();
  return true;
}

function isIgnorableError(error) {
  if (!error) return false;
  const code = error.code || error.cause?.code;
  const name = error.name || error.cause?.name;
  const ignorableCodes = [
    'UND_ERR_SOCKET',
    'UND_ERR_ABORTED',
    'UND_ERR_DESTROYED',
    'ECONNRESET',
    'ETIMEDOUT',
    'EPIPE',
    'ENOTFOUND',
    'ECONNREFUSED',
    50035, // Invalid Form Body
    10062, // Unknown Interaction
    40060, // Interaction already replied
  ];
  return (
    name === 'AbortError' ||
    name === 'DOMException' ||
    name === 'SocketError' ||
    name === 'DiscordAPIError' ||
    ignorableCodes.includes(code)
  );
}

// Una sola configuración compartida para extractor, búsquedas, mixes y precarga.
const ytdlpConfig = createYtDlpConfig();
ytdlpConfig.validate();
setYtDlpPath(ytdlpConfig.executablePath);
setFFmpegPath(ffmpegPath);

try {
  ytdlpConfig.writeConfigFiles();
} catch (error) {
  console.warn('[yt-dlp config]', error.message);
}

const preloader = createNextTrackPreloader(ytdlpConfig);

async function stopPlayback(guildId, message) {
  sleepTimer.cancel(guildId);
  await preloader.clear(guildId).catch(console.error);
  await disablePlayerPanel(guildId, message);
  const queue = player.nodes.get(guildId);
  if (queue) queue.delete();
}

const sleepTimer = createSleepTimer({
  onExpire: async (guildId) => {
    const queue = player.nodes.get(guildId);
    if (!queue) return;
    const channel = queue.metadata;
    await stopPlayback(guildId, '🌙 Sleep timer completado. Música detenida.');
    await channel?.send('🌙 **Sleep timer completado.** Música apagada y bot desconectado.').catch(() => {});
  },
});

// Registro de inicio de reproducción + Estadísticas en SQLite
player.events.on('playerStart', (queue, track) => {
  recordPlay({
    guildId: queue.guild.id,
    userId: track.requestedBy?.id,
    userTag: track.requestedBy?.tag || track.requestedBy?.username,
    title: track.cleanTitle ?? track.title,
    author: track.author,
    url: track.url,
    duration: track.duration,
    durationMs: track.durationMS || 0,
  });

  updatePlayerPanel(queue, track).catch(console.error);
  preloader.schedule(queue, track);
});

player.events.on('playerPause', (queue) => updatePlayerPanel(queue).catch(console.error));
player.events.on('playerResume', (queue) => updatePlayerPanel(queue).catch(console.error));
player.events.on('audioTrackAdd', (queue) => preloader.schedule(queue));
player.events.on('audioTracksAdd', (queue) => preloader.schedule(queue));
player.events.on('playerFinish', (queue, track) => {
  sleepTimer.handleTrackFinished(queue.guild.id, track.id);
  preloader.trackFinished(track).catch(console.error);
});
player.events.on('playerSkip', (queue, track) => {
  sleepTimer.handleTrackFinished(queue.guild.id, track.id);
  preloader.trackFinished(track).catch(console.error);
});
player.events.on('emptyQueue', (queue) => {
  sleepTimer.cancel(queue.guild.id);
  preloader.clear(queue.guild.id).catch(console.error);
  disablePlayerPanel(queue.guild.id, '✅ La cola terminó.').catch(console.error);
});
player.events.on('disconnect', (queue) => {
  sleepTimer.cancel(queue.guild.id);
  preloader.clear(queue.guild.id).catch(console.error);
  disablePlayerPanel(queue.guild.id, '👋 Bot desconectado del canal de voz.').catch(console.error);
});

player.events.on('playerError', (queue, error, track) => {
  console.error(`[Audio/${queue.guild.name}] ${track?.title ?? 'Pista desconocida'}: ${error.message}`);
  queue.metadata?.send('⚠️ Esa canción no entregó audio; la saltaré e intentaré continuar con la cola.').catch(console.error);
});

player.events.on('error', (queue, error) => {
  console.error(`[Cola/${queue.guild.name}] ${error.message}`);
});

await player.extractors.loadMulti(DefaultExtractors);
const youtubeDlpExtractor = await player.extractors.register(YouTubeDlpExtractor, {
  agent: {
    autoCookiesFromBrowser: false,
    forceIPv4: true,
  },
  playlistSearchLimit: 200,
  debug: false,
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`✅ LomuyayoMusic v1.3.5 conectado como ${readyClient.user.tag} (PID ${process.pid})`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.inGuild()) return;
  if (!acceptInteraction(interaction.id)) {
    console.warn(`[Interacción duplicada ignorada] ${interaction.id}`);
    return;
  }

  if (isPlayerButton(interaction)) {
    await handlePlayerButton(interaction);
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  console.log(`[Comando] /${interaction.commandName} solicitado por ${interaction.user.tag} en ${interaction.guild.name}`);

  try {
    await player.context.provide({ guild: interaction.guild }, async () => {
      if (interaction.commandName === 'play') return handlePlay(interaction);
      return handleControl(interaction);
    });
  } catch (error) {
    console.error(`Error en /${interaction.commandName}:`, error);
    const message = { content: '❌ Ocurrió un error inesperado. Revisa la consola del bot.', flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) await interaction.followUp(message).catch(() => {});
    else await interaction.reply(message).catch(() => {});
  }
});

async function handlePlay(interaction) {
  const context = getVoiceContext(interaction, { requireQueue: false });
  if (context.error) return interaction.reply({ content: context.error, flags: MessageFlags.Ephemeral });

  const query = interaction.options.getString('consulta', true).trim();
  if (!query) return interaction.reply({ content: '❌ Escribe una URL o el nombre de una canción.', flags: MessageFlags.Ephemeral });

  await interaction.deferReply();

  try {
    const mixRequest = isYouTubeMix(query);
    await interaction.editReply(mixRequest
      ? '🔎 Expandiendo el mix de YouTube y preparando la cola...'
      : '🔎 Buscando y preparando el audio con yt-dlp...');

    const playable = mixRequest
      ? await expandYouTubeMix({
        player,
        extractor: youtubeDlpExtractor,
        ytdlpConfig,
        query,
        requestedBy: interaction.user,
        onTrackHydrated: (track) => {
          const queue = player.nodes.get(interaction.guildId);
          if (queue?.currentTrack?.id === track.id) updatePlayerPanel(queue, track).catch(console.error);
        },
      })
      : query;

    const result = await player.play(context.voiceChannel, playable, {
      requestedBy: interaction.user,
      nodeOptions: {
        metadata: interaction.channel,
        bufferingTimeout: 15_000,
        leaveOnStop: true,
        leaveOnStopCooldown: 1_000,
        leaveOnEnd: true,
        leaveOnEndCooldown: 30_000,
        leaveOnEmpty: true,
        leaveOnEmptyCooldown: 60_000,
        skipOnNoStream: true,
        onBeforeCreateStream: (track) => preloader.beforeCreateStream(track),
      },
    });

    const playlist = result.track.playlist;
    if (playlist) {
      return interaction.editReply(`✅ Playlist **${playlist.title}** añadida (${playlist.tracks.length} canciones).`);
    }
    return interaction.editReply(`✅ **${result.track.cleanTitle ?? result.track.title}** añadida a la cola.`);
  } catch (error) {
    console.error('Error al buscar/reproducir:', error);
    const msg = isIgnorableError(error)
      ? '⚠️ Ocurrió una pequeña desconexión de red al buscar la canción. Inténtalo de nuevo.'
      : '❌ No pude encontrar o reproducir esa solicitud. Comprueba el enlace, que el video sea público y vuelve a intentarlo.';
    return interaction.editReply(msg).catch(() => {});
  }
}

async function handleControl(interaction) {
  const { commandName, guildId } = interaction;

  if (commandName === 'panel') {
    const queue = player.nodes.get(guildId);
    return interaction.reply(mainPanelPayload(queue));
  }

  if (commandName === 'queue') {
    const queue = player.nodes.get(guildId);
    return interaction.reply({
      ...queuePanelPayload(queue, 0),
      flags: MessageFlags.Ephemeral,
    });
  }

  if (commandName === 'stats') {
    return interaction.reply(statsPanelPayload(guildId, 'day'));
  }

  if (commandName === 'config') {
    const queue = player.nodes.get(guildId);
    return interaction.reply({
      ...configPanelPayload(queue, guildId),
      flags: MessageFlags.Ephemeral,
    });
  }

  if (commandName === 'sleep') {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'estado') {
      const state = sleepTimer.get(guildId);
      if (!state) return interaction.reply({ content: '🌙 No hay ningún sleep timer activo.', flags: MessageFlags.Ephemeral });
      const description = state.mode === 'track'
        ? 'al terminar la canción actual'
        : `en **${Math.max(1, Math.ceil(state.remainingMs / 60_000))} minuto(s)**`;
      return interaction.reply({ content: `🌙 La música se detendrá ${description}.`, flags: MessageFlags.Ephemeral });
    }
    if (subcommand === 'cancelar') {
      const cancelled = sleepTimer.cancel(guildId);
      return interaction.reply({ content: cancelled ? '✅ Sleep timer cancelado.' : '🌙 No había ningún sleep timer activo.', flags: MessageFlags.Ephemeral });
    }

    const context = getVoiceContext(interaction);
    if (context.error) return interaction.reply({ content: context.error, flags: MessageFlags.Ephemeral });
    if (!context.queue.currentTrack) return interaction.reply({ content: '❌ No hay una canción reproduciéndose.', flags: MessageFlags.Ephemeral });
    if (subcommand === 'cancion') {
      sleepTimer.setEndOfTrack(guildId, context.queue.currentTrack.id, interaction.user.tag);
      return interaction.reply('🌙 Sleep timer activado: apagaré la música al terminar esta canción.');
    }
    const minutes = interaction.options.getInteger('cantidad', true);
    sleepTimer.setMinutes(guildId, minutes, interaction.user.tag);
    return interaction.reply(`🌙 Sleep timer activado por **${minutes} minuto(s)**.`);
  }

  const context = getVoiceContext(interaction);
  if (context.error) return interaction.reply({ content: context.error, flags: MessageFlags.Ephemeral });

  const { queue } = context;
  switch (commandName) {
    case 'pause':
      if (!queue.isPlaying()) return interaction.reply({ content: '❌ No hay una canción reproduciéndose.', flags: MessageFlags.Ephemeral });
      if (queue.node.isPaused()) return interaction.reply({ content: '⏸️ La reproducción ya está pausada.', flags: MessageFlags.Ephemeral });
      queue.node.pause();
      return interaction.reply('⏸️ Reproducción pausada.');
    case 'resume':
      if (!queue.node.isPaused()) return interaction.reply({ content: '❌ La reproducción no está pausada.', flags: MessageFlags.Ephemeral });
      queue.node.resume();
      return interaction.reply('▶️ Reproducción reanudada.');
    case 'skip':
      if (!queue.currentTrack) return interaction.reply({ content: '❌ No hay una canción para saltar.', flags: MessageFlags.Ephemeral });
      queue.node.skip();
      return interaction.reply('⏭️ Canción saltada.');
    case 'stop':
    case 'leave':
      await stopPlayback(guildId, '⏹️ Reproducción detenida y cola borrada.');
      return interaction.reply('⏹️ Cola borrada y bot desconectado.');
    default:
      return interaction.reply({ content: '❌ Comando desconocido.', flags: MessageFlags.Ephemeral });
  }
}

async function handlePlayerButton(interaction) {
  const action = playerButtonAction(interaction);
  const { guildId } = interaction;
  const queue = player.nodes.get(guildId);

  try {
    // Apertura del Modal de búsqueda (no requiere diferir)
    if (action === 'nav_search') {
      const voiceContext = getVoiceContext(interaction, { requireQueue: false });
      if (voiceContext.error) {
        await interaction.reply({ content: voiceContext.error, flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.showModal(createSearchModal());
      return;
    }

    // Envío del Modal de Búsqueda (Búsqueda de 5 resultados en YouTube)
    if (action === 'search_modal') {
      const query = interaction.fields.getTextInputValue('music:search_query').trim();
      if (!query) {
        await interaction.reply({ content: '❌ Debes ingresar un término de búsqueda.', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      try {
        const tracks = await searchYouTubeTracks({
          ytdlpConfig,
          query,
          player,
          requestedBy: interaction.user,
          limit: 5,
        });

        if (!tracks || !tracks.length) {
          await interaction.editReply(`❌ No se encontraron resultados para: **${query}**`);
          return;
        }

        userSearchResultsCache.set(interaction.user.id, tracks);
        await interaction.editReply(searchResultsPayload(query, tracks));
      } catch (error) {
        console.error('Error al procesar modal de búsqueda:', error);
        await interaction.editReply('❌ Ocurrió un error al buscar las canciones. Inténtalo de nuevo.');
      }
      return;
    }

    // Selección de canción en el Select Menu
    if (action === 'select_search') {
      const voiceContext = getVoiceContext(interaction, { requireQueue: false });
      if (voiceContext.error) {
        await interaction.reply({ content: voiceContext.error, flags: MessageFlags.Ephemeral });
        return;
      }

      const selectedIndex = Number.parseInt(interaction.values[0], 10);
      const cachedTracks = userSearchResultsCache.get(interaction.user.id);
      const selectedTrack = cachedTracks?.[selectedIndex];

      if (!selectedTrack) {
        await interaction.reply({ content: '❌ La sesión de búsqueda expiró. Por favor realiza una nueva búsqueda.', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      try {
        const targetUrl = selectedTrack.url || `https://www.youtube.com/watch?v=${selectedTrack.id}`;
        const result = await player.play(voiceContext.voiceChannel, targetUrl, {
          requestedBy: interaction.user,
          nodeOptions: {
            metadata: interaction.channel,
            bufferingTimeout: 15_000,
            leaveOnStop: true,
            leaveOnStopCooldown: 1_000,
            leaveOnEnd: true,
            leaveOnEndCooldown: 30_000,
            leaveOnEmpty: true,
            leaveOnEmptyCooldown: 60_000,
            skipOnNoStream: true,
            onBeforeCreateStream: (track) => preloader.beforeCreateStream(track),
          },
        });

        await interaction.editReply(`✅ **${result.track.cleanTitle ?? result.track.title}** añadida a la cola por ${interaction.user}.`);

        const activeQueue = player.nodes.get(guildId);
        if (activeQueue) {
          await updatePlayerPanel(activeQueue, activeQueue.currentTrack);
        }
      } catch (error) {
        console.error('Error al añadir canción desde el Select Menu:', error);
        await interaction.editReply('❌ No se pudo reproducir la canción seleccionada.');
      }
      return;
    }

    // Navegación rápida entre pestañas del Dashboard
    if (action === 'nav_home') {
      await interaction.update(mainPanelPayload(queue));
      return;
    }

    if (action === 'nav_queue') {
      await interaction.update(queuePanelPayload(queue, 0));
      return;
    }

    if (action === 'nav_config') {
      await interaction.update(configPanelPayload(queue, guildId));
      return;
    }

    if (action === 'nav_stats' || action.startsWith('stats_chart:')) {
      const chartType = action.startsWith('stats_chart:') ? action.slice('stats_chart:'.length) : 'day';
      await interaction.update(statsPanelPayload(guildId, chartType));
      return;
    }

    // Paginación de la cola
    if (action.startsWith('queuepage:')) {
      const page = Number.parseInt(action.slice('queuepage:'.length), 10) || 0;
      await interaction.update(queuePanelPayload(queue, page));
      return;
    }

    // Validaciones de canal de voz para controles activos
    const voiceContext = getVoiceContext(interaction);
    if (voiceContext.error) {
      await interaction.reply({ content: voiceContext.error, flags: MessageFlags.Ephemeral });
      return;
    }

    const activeQueue = voiceContext.queue;

    // Limpiar la cola sin detener la canción actual
    if (action === 'clearqueue') {
      if (activeQueue.tracks.size === 0) {
        await interaction.reply({ content: '❌ La cola ya está vacía.', flags: MessageFlags.Ephemeral });
        return;
      }
      activeQueue.tracks.clear();
      await interaction.reply({ content: '🗑️ Se han eliminado todas las canciones de la cola. La canción actual sigue reproduciéndose.', flags: MessageFlags.Ephemeral });
      await updatePlayerPanel(activeQueue);
      return;
    }

    if (action === 'queueshuffle') {
      if (activeQueue.tracks.size < 2) {
        await interaction.reply({ content: '❌ Se necesitan al menos 2 canciones en la cola para mezclar.', flags: MessageFlags.Ephemeral });
        return;
      }
      activeQueue.tracks.shuffle();
      await interaction.update(queuePanelPayload(activeQueue, 0));
      return;
    }

    if (action === 'queueskip') {
      if (activeQueue.currentTrack) activeQueue.node.skip();
      await interaction.update(queuePanelPayload(activeQueue, 0));
      return;
    }

    // Ajustes de configuración
    if (action.startsWith('config_repeat_')) {
      const modeStr = action.slice('config_repeat_'.length);
      let newMode = QueueRepeatMode.OFF;
      if (modeStr === 'song') newMode = QueueRepeatMode.TRACK;
      if (modeStr === 'queue') newMode = QueueRepeatMode.QUEUE;

      activeQueue.setRepeatMode(newMode);
      setGuildConfig(guildId, { repeatMode: newMode });
      await interaction.update(configPanelPayload(activeQueue, guildId));
      return;
    }

    await interaction.deferUpdate();

    switch (action) {
      case 'previous':
        if (activeQueue.history.previousTrack) {
          await activeQueue.history.previous(true);
        } else if (activeQueue.currentTrack) {
          await activeQueue.node.seek(0);
          await updatePlayerPanel(activeQueue);
        }
        break;
      case 'toggle':
        if (activeQueue.node.isPaused()) activeQueue.node.resume();
        else activeQueue.node.pause();
        await updatePlayerPanel(activeQueue);
        break;
      case 'next':
        if (activeQueue.currentTrack) activeQueue.node.skip();
        break;
      case 'repeat': {
        let currentMode = activeQueue.repeatMode;
        let nextMode = QueueRepeatMode.OFF;
        if (currentMode === QueueRepeatMode.OFF) nextMode = QueueRepeatMode.TRACK;
        else if (currentMode === QueueRepeatMode.TRACK) nextMode = QueueRepeatMode.QUEUE;
        else nextMode = QueueRepeatMode.OFF;

        activeQueue.setRepeatMode(nextMode);
        setGuildConfig(guildId, { repeatMode: nextMode });
        await updatePlayerPanel(activeQueue);
        break;
      }
      case 'stop':
        await stopPlayback(guildId, '⏹️ Reproducción detenida y cola borrada.');
        break;
      default:
        await interaction.followUp({ content: '❌ Control desconocido.', flags: MessageFlags.Ephemeral });
    }
  } catch (error) {
    if (isIgnorableError(error)) {
      console.warn('[Warning Interacción Ignorada]', error?.message || error?.code);
      return;
    }
    console.error('Error en el panel de música:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Ocurrió un error al procesar el control.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}

process.on('unhandledRejection', (error) => {
  if (isIgnorableError(error)) {
    console.warn('[Red/API Warning] Petición/Socket desestimado:', error?.message || error?.code);
    return;
  }
  console.error('Promesa rechazada:', error);
});

process.on('uncaughtException', (error) => {
  if (isIgnorableError(error)) {
    console.warn('[Red/API Warning] Excepción desestimada:', error?.message || error?.code);
    return;
  }
  console.error('Excepción no controlada:', error);
});

// Panel local heredado: desactivado por defecto. El dashboard público vive en /dashboard.
const webServer = process.env.LEGACY_LOCAL_DASHBOARD_ENABLED === 'true'
  ? startWebDashboard({ client, player, sleepTimer, onStop: stopPlayback })
  : null;

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    webServer?.close();
    instanceLock.close();
    client.destroy();
    process.exit(0);
  });
}

client.login(DISCORD_BOT_TOKEN);
