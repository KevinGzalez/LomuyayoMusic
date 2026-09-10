# LomuyayoMusic Dashboard

Aplicación Next.js separada del bot. Vercel ejecuta autenticación, RBAC y la interfaz; no ejecuta Discord, yt-dlp, FFmpeg ni PO Token.

## Desarrollo

1. Copia `.env.example` como `.env.local` y completa valores locales.
2. Crea una base PostgreSQL vacía.
3. Ejecuta `npm run db:migrate`.
4. Define temporalmente `INITIAL_ADMIN_USERNAME` y `INITIAL_ADMIN_PASSWORD`, ejecuta `npm run db:seed` y después elimina la contraseña del entorno.
5. Ejecuta `npm run dev`.

El seed nunca reemplaza un administrador existente y almacena la contraseña con bcrypt, coste 12. La cuenta inicial queda marcada para cambio obligatorio de contraseña.

## Separación de datos

- PostgreSQL: usuarios, sesiones, roles y auditoría del dashboard.
- SQLite en Oracle: reproducciones, historial y estadísticas musicales.
- Oracle Agent: único propietario del Discord client, player, cola, voz, yt-dlp, cookies y PO Token.

## Comunicación con Oracle

`src/lib/agent-client.ts` firma cada solicitud con HMAC-SHA256 usando método, ruta, cuerpo, timestamp y nonce. El Agent deberá verificar firma, ventana temporal, nonce no reutilizado y origen autorizado antes de ejecutar controles.

El primer estado visual es `OFFLINE` hasta que exista `/health` en Oracle. No se infiere que el bot está online porque Vercel responda.

## Vercel

- Root Directory: `dashboard`
- Framework Preset: `Next.js`
- Install Command: `npm install`
- Build Command: `npm run build`
- Output Directory: dejar vacío; Vercel detecta `.next`

Variables: `DATABASE_URL`, `SESSION_SECRET`, `BOT_AGENT_URL`, `BOT_AGENT_SECRET`, `APP_URL`. `INITIAL_ADMIN_USERNAME` y `INITIAL_ADMIN_PASSWORD` se usan únicamente durante el seed inicial.

Provisiona PostgreSQL mediante Neon, Supabase u otro proveedor compatible con Vercel. Activa SSL, usa una cadena pooled para `DATABASE_URL`, ejecuta `npm run db:migrate` una vez y luego `npm run db:seed` con las variables iniciales.
