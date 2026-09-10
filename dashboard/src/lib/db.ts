import postgres from 'postgres';

let client: ReturnType<typeof postgres> | undefined;
export function db() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL no está configurada.');
  client ??= postgres(process.env.DATABASE_URL, { max: 5, idle_timeout: 20, connect_timeout: 10, ssl: 'require' });
  return client;
}
