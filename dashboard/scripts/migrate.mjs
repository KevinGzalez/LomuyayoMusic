import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL.');
const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require' });
await sql.unsafe(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
await sql.end();
console.log('Esquema del dashboard actualizado.');
