import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

const controlCommands = [
  ['pause', 'Pausa la canción actual'],
  ['resume', 'Reanuda la canción pausada'],
  ['skip', 'Salta a la siguiente canción'],
  ['stop', 'Detiene la música, borra la cola y desconecta el bot'],
  ['leave', 'Alias de /stop: borra la cola y desconecta el bot'],
  ['panel', 'Muestra el panel interactivo de música'],
  ['queue', 'Muestra la cola de reproducción interactiva'],
  ['stats', 'Muestra las estadísticas y gráficos del bot'],
  ['config', 'Ajusta la configuración del reproductor para el servidor'],
];

export const commandData = [
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Reproduce una URL, playlist de YouTube o busca por texto')
    .addStringOption((option) =>
      option
        .setName('consulta')
        .setDescription('URL de YouTube, URL de playlist o nombre de la canción')
        .setRequired(true)
        .setMaxLength(500),
    ),
  new SlashCommandBuilder()
    .setName('sleep')
    .setDescription('Programa cuándo debe detenerse la música')
    .addSubcommand((subcommand) => subcommand
      .setName('minutos')
      .setDescription('Detiene la música después de un tiempo')
      .addIntegerOption((option) => option
        .setName('cantidad')
        .setDescription('Minutos hasta apagar la música (1-480)')
        .setMinValue(1)
        .setMaxValue(480)
        .setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName('cancion').setDescription('Detiene la música cuando termine la canción actual'))
    .addSubcommand((subcommand) => subcommand.setName('estado').setDescription('Muestra el temporizador activo'))
    .addSubcommand((subcommand) => subcommand.setName('cancelar').setDescription('Cancela el temporizador activo')),
  ...controlCommands.map(([name, description]) =>
    new SlashCommandBuilder().setName(name).setDescription(description),
  ),
].map((command) => command.setDMPermission(false));

export function getVoiceContext(interaction, { requireQueue = true } = {}) {
  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) {
    return { error: '❌ Debes estar conectado a un canal de voz.' };
  }

  const botMember = interaction.guild.members.me;
  const permissions = voiceChannel.permissionsFor(botMember);
  if (!permissions?.has(PermissionFlagsBits.Connect)) {
    return { error: '❌ No tengo permiso para **Conectar** en tu canal de voz.' };
  }
  if (!permissions.has(PermissionFlagsBits.Speak)) {
    return { error: '❌ No tengo permiso para **Hablar** en tu canal de voz.' };
  }

  const queue = interaction.client.player.nodes.get(interaction.guildId);
  if (queue?.channel && queue.channel.id !== voiceChannel.id) {
    return { error: `❌ Debes estar en mi canal de voz: ${queue.channel}.` };
  }
  if (requireQueue && !queue) {
    return { error: '❌ No hay ninguna cola de reproducción activa.' };
  }

  return { voiceChannel, queue };
}
