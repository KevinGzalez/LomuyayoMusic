import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { commandData } from './commands.js';

// DISCORD_BOT_TOKEN y CLIENT_ID se colocan en el archivo .env (copia .env.example).
const { DISCORD_BOT_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!DISCORD_BOT_TOKEN || !CLIENT_ID) {
  console.error('Faltan DISCORD_BOT_TOKEN o CLIENT_ID en el archivo .env.');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);
const route = GUILD_ID
  ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
  : Routes.applicationCommands(CLIENT_ID);

try {
  console.log(`Registrando ${commandData.length} comandos ${GUILD_ID ? 'en el servidor de pruebas' : 'globalmente'}...`);
  await rest.put(route, { body: commandData.map((command) => command.toJSON()) });
  console.log('✅ Slash commands registrados correctamente.');
} catch (error) {
  console.error('❌ No se pudieron registrar los comandos:', error);
  process.exitCode = 1;
}
