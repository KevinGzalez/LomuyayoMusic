import { existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

function cleanValue(name, value, fallback) {
  const result = String(value || fallback).trim();
  if (!result || /[\r\n\0]/.test(result)) throw new Error(`${name} contiene un valor inválido.`);
  return result;
}

function quoteConfig(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

export function createYtDlpConfig(env = process.env) {
  const require = createRequire(import.meta.url);
  const packageEntry = require.resolve('ytdlp-nodejs');
  const binDirectory = resolve(dirname(packageEntry), '..', 'bin');
  const bundledPath = resolve(binDirectory, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  const executablePath = env.YT_DLP_PATH ? resolve(env.YT_DLP_PATH) : bundledPath;
  const cookiesFile = env.YT_DLP_COOKIES_FILE ? resolve(env.YT_DLP_COOKIES_FILE) : null;
  const playerClient = cleanValue('YT_DLP_PLAYER_CLIENT', env.YT_DLP_PLAYER_CLIENT, 'mweb');
  const jsRuntime = cleanValue('YT_DLP_JS_RUNTIME', env.YT_DLP_JS_RUNTIME, process.platform === 'win32' ? 'node' : 'node:/usr/bin/node');

  function commonArgs() {
    return [
      ...(cookiesFile ? ['--cookies', cookiesFile] : []),
      '--extractor-args',
      `youtube:player_client=${playerClient}`,
      '--js-runtimes',
      jsRuntime,
      '--no-warnings',
    ];
  }

  function configFileContent() {
    return [
      ...(cookiesFile ? [`--cookies ${quoteConfig(cookiesFile)}`] : []),
      `--extractor-args ${quoteConfig(`youtube:player_client=${playerClient}`)}`,
      `--js-runtimes ${quoteConfig(jsRuntime)}`,
      '--no-warnings',
      '',
    ].join('\n');
  }

  function writeConfigFiles() {
    const content = configFileContent();
    writeFileSync(resolve(binDirectory, 'yt-dlp.conf'), content, { encoding: 'utf8', mode: 0o600 });
    writeFileSync(resolve(process.cwd(), 'yt-dlp.conf'), content, { encoding: 'utf8', mode: 0o600 });
  }

  function validate() {
    if (!existsSync(executablePath)) throw new Error('No se encontró el ejecutable configurado de yt-dlp.');
    if (cookiesFile && !existsSync(cookiesFile)) throw new Error('YT_DLP_COOKIES_FILE apunta a un archivo inexistente.');
  }

  return { binDirectory, commonArgs, cookiesFile, executablePath, jsRuntime, playerClient, validate, writeConfigFiles };
}

