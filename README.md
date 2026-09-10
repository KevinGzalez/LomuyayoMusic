# LomuyayoMusic

Bot de música para Discord basado en Node.js, discord.js v14 y discord-player v7.

## Requisitos

- Node.js 22.12 o posterior.
- Un bot creado en Discord Developer Portal.
- Permisos del bot: `View Channels`, `Send Messages`, `Connect` y `Speak`.

FFmpeg se instala localmente mediante la dependencia `ffmpeg-static`; no es necesario instalarlo manualmente en Windows.

## Instalación

1. Ejecuta `npm run setup`. Este comando instala todo y evita una comprobación innecesaria de Python hecha por la dependencia de respaldo de YouTube.
2. Copia `.env.example` a `.env`.
3. Coloca en `.env` el token en `DISCORD_BOT_TOKEN` y el Application ID en `CLIENT_ID`.
4. Para desarrollo, coloca también el ID de tu servidor en `GUILD_ID`.
5. Ejecuta `npm run deploy` una vez para registrar los slash commands.
6. Inicia el bot con `npm start`.

Si registras los comandos globalmente (sin `GUILD_ID`), Discord puede tardar en propagarlos. Los comandos de servidor aparecen casi inmediatamente.

## Comandos

- `/play consulta:` acepta un video, una playlist de YouTube o texto de búsqueda.
- `/pause`, `/resume`, `/skip`, `/stop` y `/leave` controlan la cola.
- `/sleep minutos cantidad:`, `/sleep cancion`, `/sleep estado` y `/sleep cancelar` programan el apagado automático.

## Dashboard web

El dashboard local heredado está desactivado por defecto. Puede habilitarse solo para desarrollo con `LEGACY_LOCAL_DASHBOARD_ENABLED=true`; la aplicación pública independiente vive en `/dashboard`.

Puedes cambiar la dirección con `WEB_HOST` y `WEB_PORT`. Si lo expones en tu red, define `WEB_DASHBOARD_TOKEN`; el navegador solicitará la clave la primera vez que uses un control.

Al comenzar una canción, el bot publica un panel **Reproduciendo ahora** con portada, duración, canciones restantes y botones para volver a la anterior, pausar/reanudar, avanzar, detener o desconectar.

El botón **Ver cola** muestra las canciones pendientes en páginas de 10. A mitad de la canción actual, el bot precarga únicamente la siguiente en `.cache/next-track`; la usa para reducir la espera entre pistas y la elimina automáticamente después.

Los mixes automáticos de YouTube (`list=RD...`) se expanden hasta un máximo de 50 canciones. Las playlists normales se añaden directamente a la cola.

El bot incluye un bloqueo de instancia única. Si ya está abierto en otra terminal, una segunda ejecución finalizará con un aviso; esto evita respuestas duplicadas y conflictos en la conexión de voz.

## Nota sobre YouTube

discord-player v7 retiró su extractor oficial de YouTube. Este proyecto usa `discord-player-youtubedlp`, extractor comunitario listado por discord-player que transmite el audio mediante yt-dlp y FFmpeg. YouTube cambia sus sistemas internos con frecuencia, por lo que puede ser necesario actualizar el extractor si la reproducción deja de funcionar. Respeta los términos de servicio y derechos de autor aplicables.

La configuración compartida de yt-dlp usa `YT_DLP_COOKIES_FILE`, `YT_DLP_PLAYER_CLIENT`, `YT_DLP_JS_RUNTIME` y `YT_DLP_PATH`. En Oracle deben configurarse mediante el entorno del proceso; nunca guardes cookies o tokens en Git.
