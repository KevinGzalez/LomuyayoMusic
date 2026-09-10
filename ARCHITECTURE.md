# Arquitectura objetivo de LomuyayoMusic

## Componentes

1. El bot existente en la raíz sigue ejecutándose exclusivamente en Oracle.
2. `/dashboard` es el control plane Next.js desplegable en Vercel.
3. Un Bot Agent ligero se incorporará al proceso existente; nunca creará un segundo `Player`.

## Flujo

`Navegador -> Next.js/Vercel -> solicitud HMAC -> Oracle Agent -> MusicService -> discord-player`

Los comandos Discord y el Agent convergerán gradualmente en los mismos servicios internos: `MusicService`, `QueueService`, `YouTubeService`, `StatsService` y `BotLifecycleManager`.

## Tiempo real

La primera integración usará polling moderado desde Vercel para heartbeat y estado, evitando depender de WebSockets persistentes dentro de funciones serverless. Para eventos de baja latencia se evaluará SSE desde un endpoint HTTPS público del Agent o un proveedor realtime; el navegador no recibirá `BOT_AGENT_SECRET`.

## Seguridad

- Sesiones opacas almacenadas con hash en PostgreSQL y cookie HttpOnly.
- RBAC validado en Route Handlers, nunca solo en React.
- HMAC, timestamp y nonce para Vercel -> Agent.
- El Agent aceptará únicamente acciones tipadas, sin shell ni acceso arbitrario al filesystem.
- Cookies de YouTube, claves SSH y `.env` permanecen fuera de Vercel y Git.

## Fases siguientes

1. Extraer servicios internos manteniendo los comandos existentes.
2. Implementar `BotLifecycleManager` con IDLE, SLEEPING, STARTING y wake único.
3. Crear `/health` y API Agent autenticada.
4. Conectar páginas Search, Queue, Stats, Bot y Users.
5. Añadir administración de usuarios, cambio de contraseña y auditoría completa.
6. Endurecer rate limits, CSRF/origin checks, nonces HMAC, proxy HTTPS y CORS.
