import bcrypt from 'bcryptjs';
import postgres from 'postgres';

const { DATABASE_URL, INITIAL_ADMIN_USERNAME, INITIAL_ADMIN_PASSWORD } = process.env;
if (!DATABASE_URL || !INITIAL_ADMIN_USERNAME || !INITIAL_ADMIN_PASSWORD) throw new Error('Faltan DATABASE_URL, INITIAL_ADMIN_USERNAME o INITIAL_ADMIN_PASSWORD.');
if (INITIAL_ADMIN_PASSWORD.length < 8) throw new Error('La contraseña inicial debe tener al menos 8 caracteres.');
const sql = postgres(DATABASE_URL, { max: 1, ssl: 'require' });
const passwordHash = await bcrypt.hash(INITIAL_ADMIN_PASSWORD, 12);
const existing = await sql`SELECT id FROM dashboard_users WHERE LOWER(username)=LOWER(${INITIAL_ADMIN_USERNAME})`;
if (!existing.length) {
  await sql`INSERT INTO dashboard_users (username,password_hash,role,must_change_password) VALUES (${INITIAL_ADMIN_USERNAME},${passwordHash},'SUPER_ADMIN',TRUE)`;
  console.log('Administrador inicial creado; debe cambiar su contraseña al entrar.');
} else console.log('El administrador inicial ya existe; no se modificó.');
await sql.end();
