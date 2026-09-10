# Documento de Requisitos y Dependencias - LomuyayoMusic Bot

Este documento detalla **todas las dependencias y requisitos técnicos** necesarios para desplegar y alojar el bot en una Máquina Virtual (VM) Linux/Unix o Windows.

---

## 1. Entorno de Ejecución (Runtime)

| Componente | Versión Requerida | Notas |
| :--- | :--- | :--- |
| **Node.js** | `>= 22.12.0` *(Recomendado: 22.x LTS)* | El proyecto usa **ES Modules** (`"type": "module"`) y características modernas de JS. |
| **npm** | `>= 10.0.0` | Gestor de paquetes incluido por defecto con Node.js. |

---

## 2. Dependencias a Nivel de Sistema Operativo (Linux VM)

Para garantizar la reproducción continua de audio sin errores de codificación o problemas de red, se requiere tener instalados los siguientes paquetes del sistema:

### En Ubuntu / Debian / Linux Mint:
```bash
sudo apt update && sudo apt install -y \
  curl \
  git \
  python3 \
  ffmpeg \
  build-essential \
  ca-certificates
```

### Explicación de paquetes del sistema:
- **`ffmpeg`**: Necesario para transcodificar, mezclar y transmitir audio de alta calidad a los canales de voz de Discord. *(Aunque el proyecto incluye `ffmpeg-static`, el binario del sistema asegura compatibilidad total con librerías nativas).*
- **`python3`**: Requerido internamente por `yt-dlp` / `ytdlp-nodejs` para la extracción y parsing dinámico de tokens y URLs de audio de YouTube.
- **`build-essential` (gcc, g++, make)**: Necesario en Linux si alguna librería nativa (`@discordjs/voice`, `opus`, `zlib-sync`) requiere recompilación nativa (`node-gyp`).
- **`ca-certificates` & `curl`**: Necesarios para conexiones HTTPS seguras al descargar streams de YouTube y comunicarse con las APIs de Discord.

---

## 3. Dependencias de Node.js (npm packages)

A continuación se listan todas las librerías declaradas en `package.json` y sus versiones específicas instaladas:

### Librerías Principales (`dependencies`)

| Paquete npm | Versión | Descripción / Propósito |
| :--- | :--- | :--- |
| **`discord.js`** | `14.27.0` | Cliente oficial para interactuar con la API y Gateway de Discord (Slash commands, eventos, paneles). |
| **`discord-player`** | `7.2.0` | Framework principal de reproducción de música, colas de reproducción y gestión de estados de audio. |
| **`discord-player-youtubedlp`** | `1.2.1` | Extractor secundario/comunitario para obtener streams de audio de YouTube mediante `yt-dlp`. |
| **`@discord-player/extractor`** | `7.2.0` | Extractor oficial de metadatos y fuentes alternativas (Spotify, Soundcloud, enlaces directos, etc.). |
| **`@discordjs/voice`** | `0.19.2` | Manejo nativo de conexiones de voz de Discord, cifrado UDP de paquetes de audio y streaming Opus. |
| **`dotenv`** | `17.4.2` | Carga de variables de entorno desde el archivo `.env`. |
| **`ffmpeg-static`** | `5.3.0` | Binarios estáticos integrados de FFmpeg para Node.js. |
| **`quickchart-js`** | `^4.0.0` | Generación dinámica de gráficos e imágenes estadísticas para el bot. |
| **`undici`** | `8.10.0` | Cliente HTTP rápido para peticiones de red a la API de Discord y YouTube. |

---

## 4. Archivos de Configuración y Datos Requeridos

### A. Variables de Entorno (`.env`)
Debes crear un archivo `.env` en la raíz del proyecto con la siguiente estructura:

```env
# Token secreto de tu bot (Discord Developer Portal > Bot > Reset Token)
DISCORD_BOT_TOKEN=tu_token_aqui

# Application ID de la aplicación (Discord Developer Portal > General Information)
CLIENT_ID=tu_client_id_aqui

# Opcional: ID de tu servidor para desplegar comandos instantáneamente en pruebas
GUILD_ID=
```

### B. Configuración de yt-dlp (`yt-dlp.conf`)
El proyecto incluye un archivo `yt-dlp.conf` en la raíz necesario para evadir bloqueos de cliente de YouTube:
```text
--extractor-args "youtube:player_client=mweb"
--js-runtimes node
--no-warnings
```

La configuración se centraliza en `src/ytdlp-config.js`. En producción se define mediante `YT_DLP_COOKIES_FILE`, `YT_DLP_PLAYER_CLIENT`, `YT_DLP_JS_RUNTIME` y, opcionalmente, `YT_DLP_PATH`; las cookies nunca deben entrar al repositorio.

### C. Directorios Generados Automáticamente
- **`.cache/`**: Usado por el precargador de canciones (`next-track-preloader.js`) para almacenar en búfer la siguiente pista.
- **`data/`**: Contiene la base de datos de estadísticas y configuración local (`stats.json`, etc.).

---

## 5. Permisos Requeridos en Discord Developer Portal

Al invitar al bot a tu servidor mediante el enlace OAuth2, debes otorgarle los siguientes permisos mínimos:

### Permisos de Bot (Bot Scopes: `bot`, `applications.commands`)
- **View Channels** (`VER_CANALES`)
- **Send Messages** (`ENVIAR_MENSAJES`)
- **Embed Links** (`INSERTAR_ENLACES`)
- **Attach Files** (`ADJUNTAR_ARCHIVOS`)
- **Connect** (`CONECTAR`)
- **Speak** (`HABLAR`)
- **Use Voice Activity** (`USAR_ACTIVIDAD_DE_VOZ`)

---

## 6. Guía Rápida para Montar en una VM Linux (Ubuntu 22.04 / 24.04 LTS)

### Paso 1: Instalar Node.js 22 LTS y Paquetes de Sistema
```bash
# Actualizar el sistema
sudo apt update && sudo apt upgrade -y

# Instalar herramientas básicas y FFmpeg + Python3
sudo apt install -y curl git python3 ffmpeg build-essential

# Instalar Node.js 22 LTS desde NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Verificar versiones
node -v   # Debe mostrar v22.12.0 o superior
npm -v    # Debe mostrar v10.x.x
```

### Paso 2: Desplegar el Proyecto
```bash
# Clonar o subir el proyecto a la VM y acceder al directorio
cd /ruta/a/bo-de-musica-de-dicol

# Instalar dependencias del proyecto
npm run setup

# Crear y configurar las variables de entorno
cp ".env copy.example" .env
nano .env   # (Edita y coloca tu DISCORD_BOT_TOKEN y CLIENT_ID)

# Registrar los Slash Commands en Discord
npm run deploy
```

### Paso 3: Mantener el Bot en Ejecución Continua (PM2)
En una VM se recomienda usar **PM2** para que el bot corra en segundo plano y se reinicie automáticamente si la VM se reinicia o se cae el proceso:

```bash
# Instalar PM2 globalmente
sudo npm install -g pm2

# Iniciar el bot con PM2
pm2 start src/index.js --name "lomuyayo-music"

# Guardar lista de procesos y configurar inicio automático con el sistema
pm2 save
pm2 startup
```

---

## 7. Comandos de Verificación e Inicio del Proyecto

- **Instalación limpia**: `npm run setup`
- **Comprobación de sintaxis**: `npm run check`
- **Despliegue de comandos Slash**: `npm run deploy`
- **Inicio manual**: `npm start`
