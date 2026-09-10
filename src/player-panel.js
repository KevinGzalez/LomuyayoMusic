import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { QueueRepeatMode } from 'discord-player';
import { generateChartUrl, generateVisualBar } from './chart-generator.js';
import {
  getGuildConfig,
  getGuildStats,
  getPlaysByDay,
  getTopArtists,
  getTopSongs,
  getTopUsers,
} from './stats-db.js';

const panels = new Map();
const BUTTON_PREFIX = 'music:';

function truncate(value, length) {
  const text = String(value || 'Desconocido');
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function durationLabel(track) {
  return !track?.duration || track.duration === '0:00' ? 'Calculando…' : track.duration;
}

function formatRepeatLabel(mode) {
  switch (mode) {
    case QueueRepeatMode.TRACK:
      return '🔂 Canción';
    case QueueRepeatMode.QUEUE:
      return '🔁 Cola';
    default:
      return '🔁 Repetir';
  }
}

/**
 * Fila 1: 5 Botones simétricos de Control de Reproducción (iconos limpios)
 */
function playerControlRow(queue, disabled = false) {
  const paused = queue ? queue.node.isPaused() : false;
  const repeatMode = queue ? queue.repeatMode : QueueRepeatMode.OFF;

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}previous`)
      .setEmoji('⏮️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || !queue?.currentTrack),
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}toggle`)
      .setEmoji(paused ? '▶️' : '⏸️')
      .setStyle(paused ? ButtonStyle.Success : ButtonStyle.Primary)
      .setDisabled(disabled || !queue?.currentTrack),
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}next`)
      .setEmoji('⏭️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || !queue?.currentTrack),
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}repeat`)
      .setEmoji('🔁')
      .setStyle(repeatMode !== QueueRepeatMode.OFF ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(disabled || !queue?.currentTrack),
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}stop`)
      .setEmoji('⏹️')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled || !queue?.currentTrack),
  );
}

/**
 * Fila 2: 5 Botones de Navegación y Acciones del Dashboard (IDs Únicos)
 */
function navigationRow(activeTab = 'home', queue = null) {
  const hasQueue = queue?.tracks?.size > 0;

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}nav_home`)
      .setEmoji('🏠')
      .setLabel('Inicio')
      .setStyle(activeTab === 'home' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}nav_search`)
      .setEmoji('🔎')
      .setLabel('Buscar')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}nav_queue`)
      .setEmoji('📋')
      .setLabel('Cola')
      .setStyle(activeTab === 'queue' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}clearqueue`)
      .setEmoji('🗑️')
      .setLabel('Limpiar Cola')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!hasQueue),
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}nav_stats`)
      .setEmoji('📊')
      .setLabel('Stats')
      .setStyle(activeTab === 'stats' ? ButtonStyle.Primary : ButtonStyle.Secondary),
  );
}

/**
 * Payload principal del Music Dashboard (Inicio)
 */
export function mainPanelPayload(queue, track = queue?.currentTrack) {
  if (!queue || !track) {
    const emptyEmbed = new EmbedBuilder()
      .setColor(0x2f3136)
      .setAuthor({ name: '🎵 MUSIC BOT — Sin reproducción activa' })
      .setTitle('No hay nada reproduciéndose')
      .setDescription('Presiona el botón **🔎 Buscar** o escribe `/play` para escuchar canciones.')
      .setFooter({ text: 'LomuyayoMusic v1.3.5 • Los Muyayos' });

    return {
      embeds: [emptyEmbed],
      components: [
        playerControlRow(null, true),
        navigationRow('home', null),
      ],
    };
  }

  const paused = queue.node.isPaused();
  const requester = track.requestedBy;
  const remaining = queue.tracks.size;
  const upcomingTracks = queue.tracks.toArray().slice(0, 3);

  let upNextText = '*No hay canciones en espera.*';
  if (upcomingTracks.length > 0) {
    upNextText = upcomingTracks
      .map((t, idx) => `**${idx + 1}.** ${truncate(t.cleanTitle ?? t.title, 55)} — *${truncate(t.author, 30)}*`)
      .join('\n');
  }

  const statusSymbol = paused ? '⏸️ PAUSADO' : '🔴 REPRODUCIENDO';

  const embed = new EmbedBuilder()
    .setColor(paused ? 0xf0b232 : 0x5865f2)
    .setAuthor({ name: `🎵 MUSIC BOT — ${statusSymbol}` })
    .setTitle(truncate(track.cleanTitle ?? track.title, 250))
    .setURL(track.url ?? null)
    .setDescription(`🎤 **${truncate(track.author, 150)}**`)
    .addFields(
      { name: '⏱️ Duración', value: durationLabel(track), inline: true },
      { name: '👤 Añadida por', value: requester ? `${requester.username}` : 'Desconocido', inline: true },
      { name: '🔊 Canal de Voz', value: queue.channel ? `${queue.channel}` : 'Desconocido', inline: true },
      { name: '📋 Próximas Canciones (UP NEXT)', value: upNextText, inline: false },
    )
    .setFooter({ text: `En cola: ${remaining} canción${remaining === 1 ? '' : 'es'} | LomuyayoMusic v1.3.5` });

  if (track.thumbnail) {
    embed.setThumbnail(track.thumbnail);
  }

  return {
    embeds: [embed],
    components: [
      playerControlRow(queue),
      navigationRow('home', queue),
    ],
  };
}

/**
 * Vista interactiva de la cola de reproducción
 */
export function queuePanelPayload(queue, requestedPage = 0) {
  if (!queue) {
    return {
      embeds: [
        new EmbedBuilder()
          .setColor(0xED4245)
          .setTitle('📋 Cola de Reproducción')
          .setDescription('❌ No hay una cola de reproducción activa.'),
      ],
      components: [
        playerControlRow(null, true),
        navigationRow('queue', null),
      ],
    };
  }

  const tracks = queue.tracks.toArray();
  const pageCount = Math.max(1, Math.ceil(tracks.length / 10));
  const page = Math.min(Math.max(0, requestedPage), pageCount - 1);
  const start = page * 10;

  const lines = tracks.slice(start, start + 10).map((track, index) =>
    `**${start + index + 1}.** [${truncate(track.cleanTitle ?? track.title, 60)}](${track.url}) • \`${durationLabel(track)}\` • ${track.requestedBy ? track.requestedBy.username : 'Anon'}`,
  );

  const currentTrackText = queue.currentTrack
    ? `🎵 **[EN REPRODUCCIÓN]** [${truncate(queue.currentTrack.cleanTitle ?? queue.currentTrack.title, 70)}](${queue.currentTrack.url}) • \`${durationLabel(queue.currentTrack)}\``
    : '*Ninguna canción en reproducción.*';

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📋 Cola de Reproducción')
    .setDescription([
      currentTrackText,
      '',
      '### 📋 PRÓXIMAS EN COLA',
      lines.length ? lines.join('\n') : '*No quedan canciones en espera.*',
    ].join('\n'))
    .setFooter({ text: `Total: ${tracks.length} en espera • Página ${page + 1}/${pageCount} | LomuyayoMusic v1.3.5` });

  const queueActionsRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}queuepage:${page - 1}`)
      .setEmoji('⬅️')
      .setLabel('Anterior')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}queuepage:${page + 1}`)
      .setEmoji('➡️')
      .setLabel('Siguiente')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= pageCount - 1),
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}queueshuffle`)
      .setEmoji('🔀')
      .setLabel('Mezclar')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(tracks.length < 2),
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}queueskip`)
      .setEmoji('⏭️')
      .setLabel('Saltar Pista')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(tracks.length === 0),
  );

  return {
    embeds: [embed],
    components: [
      playerControlRow(queue),
      navigationRow('queue', queue),
      ...(pageCount > 1 || tracks.length > 0 ? [queueActionsRow] : []),
    ],
  };
}

/**
 * Modal de búsqueda de música
 */
export function createSearchModal() {
  const modal = new ModalBuilder()
    .setCustomId(`${BUTTON_PREFIX}search_modal`)
    .setTitle('🔎 BUSCAR MÚSICA');

  const searchInput = new TextInputBuilder()
    .setCustomId(`${BUTTON_PREFIX}search_query`)
    .setLabel('Escribe una canción, artista o búsqueda')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Ej. Bad Bunny MONACO, The Weeknd Blinding Lights...')
    .setRequired(true)
    .setMaxLength(300);

  modal.addComponents(new ActionRowBuilder().addComponents(searchInput));
  return modal;
}

/**
 * Payload de resultados de búsqueda (hasta 5 opciones) con Select Menu
 */
export function searchResultsPayload(query, tracks) {
  if (!tracks || !tracks.length) {
    return {
      content: `❌ No se encontraron resultados para: **${truncate(query, 100)}**`,
      components: [],
    };
  }

  const topResults = tracks.slice(0, 5);
  const numberEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];

  const lines = topResults.map((t, idx) =>
    `**${numberEmojis[idx]} [${truncate(t.cleanTitle ?? t.title, 60)}](${t.url})**\n🎤 ${truncate(t.author, 45)} • \`${durationLabel(t)}\``,
  );

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🔎 Resultados de Búsqueda para: "${truncate(query, 50)}"`)
    .setDescription(lines.join('\n\n'))
    .setFooter({ text: 'Selecciona una canción en el menú desplegable para añadirla a la cola.' });

  const selectOptions = topResults.map((t, idx) => ({
    label: truncate(`${idx + 1}. ${t.cleanTitle ?? t.title}`, 100),
    description: truncate(`${t.author} (${durationLabel(t)})`, 100),
    value: String(idx),
    emoji: '🎵',
  }));

  const selectMenu = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${BUTTON_PREFIX}select_search`)
      .setPlaceholder('👉 Elige una de las 5 opciones para reproducir...')
      .addOptions(selectOptions),
  );

  return {
    embeds: [embed],
    components: [selectMenu],
  };
}

/**
 * Payload de Estadísticas
 */
export function statsPanelPayload(guildId, chartType = 'day') {
  const stats = getGuildStats(guildId);
  const totalHours = Math.floor(stats.totalDurationMs / (1000 * 60 * 60));
  const totalMins = Math.floor((stats.totalDurationMs % (1000 * 60 * 60)) / (1000 * 60));

  let breakdownText = '';
  if (chartType === 'day') {
    const daysData = getPlaysByDay(guildId);
    const maxCount = Math.max(1, ...daysData.map((d) => d.count));
    breakdownText = daysData
      .map((d) => `\`${d.label.padEnd(4)}\` \`${generateVisualBar(d.count, maxCount)}\` **${d.count}**`)
      .join('\n');
  } else if (chartType === 'artist') {
    const artistsData = getTopArtists(guildId, 5);
    const maxCount = Math.max(1, ...artistsData.map((a) => a.play_count));
    breakdownText = artistsData.length
      ? artistsData.map((a) => `\`${truncate(a.song_author, 16).padEnd(16)}\` \`${generateVisualBar(a.play_count, maxCount, 8)}\` **${a.play_count}**`).join('\n')
      : '*Sin datos de artistas aun.*';
  } else if (chartType === 'song') {
    const songsData = getTopSongs(guildId, 5);
    const maxCount = Math.max(1, ...songsData.map((s) => s.play_count));
    breakdownText = songsData.length
      ? songsData.map((s) => `\`${truncate(s.song_title, 16).padEnd(16)}\` \`${generateVisualBar(s.play_count, maxCount, 8)}\` **${s.play_count}**`).join('\n')
      : '*Sin datos de canciones aun.*';
  } else if (chartType === 'user') {
    const usersData = getTopUsers(guildId, 5);
    const maxCount = Math.max(1, ...usersData.map((u) => u.play_count));
    breakdownText = usersData.length
      ? usersData.map((u) => `\`${truncate(u.user_tag, 16).padEnd(16)}\` \`${generateVisualBar(u.play_count, maxCount, 8)}\` **${u.play_count}**`).join('\n')
      : '*Sin datos de usuarios aun.*';
  } else {
    breakdownText = `📊 **Resumen acumulado:** ${stats.totalPlays} reproducciones registradas.`;
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📊 SERVER MUSIC STATS')
    .setDescription([
      '**Métricas Principales del Servidor:**',
      `🎵 **Canciones reproducidas:** \`${stats.totalPlays.toLocaleString()}\``,
      `⏱️ **Tiempo reproducido:** \`${totalHours}h ${totalMins}m\``,
      `👥 **Usuarios activos:** \`${stats.activeUsersCount}\``,
      `🎤 **Artista #1:** **${truncate(stats.topArtist, 35)}** (${stats.topArtistCount} reproducciones)`,
      `🏆 **Canción #1:** **${truncate(stats.topSong, 45)}** (${stats.topSongCount} reproducciones)`,
      '',
      `### 📈 GRÁFICO VISUAL (${chartType.toUpperCase()})`,
      breakdownText,
    ].join('\n'))
    .setFooter({ text: 'Estadísticas en tiempo real • LomuyayoMusic v1.3.5' });

  const chartUrl = generateChartUrl(guildId, chartType);
  if (chartUrl) {
    embed.setImage(chartUrl);
  }

  const chartFilterRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}stats_chart:day`)
      .setEmoji('📈')
      .setLabel('Días')
      .setStyle(chartType === 'day' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}stats_chart:month`)
      .setEmoji('📅')
      .setLabel('Mes')
      .setStyle(chartType === 'month' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}stats_chart:artist`)
      .setEmoji('🎤')
      .setLabel('Top Artistas')
      .setStyle(chartType === 'artist' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}stats_chart:song`)
      .setEmoji('🏆')
      .setLabel('Top Canciones')
      .setStyle(chartType === 'song' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}stats_chart:user`)
      .setEmoji('👥')
      .setLabel('Top Usuarios')
      .setStyle(chartType === 'user' ? ButtonStyle.Primary : ButtonStyle.Secondary),
  );

  return {
    embeds: [embed],
    components: [
      playerControlRow(null, false),
      navigationRow('stats', null),
      chartFilterRow,
    ],
  };
}

/**
 * Payload del Panel de Configuración
 */
export function configPanelPayload(queue, guildId) {
  const config = getGuildConfig(guildId);
  const repeatMode = queue ? queue.repeatMode : config.repeatMode;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('⚙️ Ajustes del Reproductor')
    .setDescription('Modifica las preferencias de reproducción del servidor.')
    .addFields(
      { name: '🔁 Modo Repetición', value: `Estado actual: **${formatRepeatLabel(repeatMode)}**`, inline: true },
      { name: '🔀 Mezcla Aleatoria', value: `Estado actual: **${queue?.tracks?.size > 0 ? 'Disponible' : 'Sin cola suficiente'}**`, inline: true },
    )
    .setFooter({ text: 'Los ajustes se guardan automáticamente en la base de datos.' });

  const configActionsRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}config_repeat_off`)
      .setLabel('Repetición: APAGADA')
      .setStyle(repeatMode === QueueRepeatMode.OFF ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}config_repeat_song`)
      .setLabel('Repetición: CANCIÓN')
      .setStyle(repeatMode === QueueRepeatMode.TRACK ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}config_repeat_queue`)
      .setLabel('Repetición: COLA')
      .setStyle(repeatMode === QueueRepeatMode.QUEUE ? ButtonStyle.Success : ButtonStyle.Secondary),
  );

  return {
    embeds: [embed],
    components: [
      playerControlRow(queue),
      navigationRow('config', queue),
      configActionsRow,
    ],
  };
}

export function isPlayerButton(interaction) {
  return (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit())
    && interaction.customId.startsWith(BUTTON_PREFIX);
}

export function playerButtonAction(interaction) {
  return interaction.customId.slice(BUTTON_PREFIX.length);
}

/**
 * Actualiza dinámicamente el panel principal enviado previamente
 */
export async function updatePlayerPanel(queue, track = queue?.currentTrack) {
  if (!queue?.guild?.id) return;
  const channel = queue.metadata;
  if (!channel?.send) return;

  const previous = panels.get(queue.guild.id);
  const payload = mainPanelPayload(queue, track);

  try {
    if (previous?.editable) {
      await previous.edit(payload);
      return;
    }
  } catch {
    panels.delete(queue.guild.id);
  }

  try {
    const message = await channel.send(payload);
    panels.set(queue.guild.id, message);
  } catch (error) {
    console.warn('[Player Panel Update]', error.message);
  }
}

export async function disablePlayerPanel(guildId, message = '⏹️ Reproducción finalizada.') {
  const panel = panels.get(guildId);
  panels.delete(guildId);
  if (!panel?.editable) return;

  const disabledEmbed = new EmbedBuilder()
    .setColor(0xED4245)
    .setAuthor({ name: '⏹️ Reproductor Detenido' })
    .setDescription(message)
    .setFooter({ text: 'LomuyayoMusic v1.3.5 • Los Muyayos' });

  await panel.edit({
    content: null,
    embeds: [disabledEmbed],
    components: [
      playerControlRow(null, true),
      navigationRow('home', null),
    ],
  }).catch(() => {});
}
