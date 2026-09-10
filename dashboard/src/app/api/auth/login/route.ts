import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createSession } from '@/lib/auth';
import { db } from '@/lib/db';

const inputSchema = z.object({ username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9_.-]+$/), password: z.string().min(8).max(200) });
export async function POST(request: NextRequest) {
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Credenciales inválidas.' }, { status: 400 });
  const rows = await db()`SELECT id,username,password_hash,role,active,locked_until FROM dashboard_users WHERE LOWER(username)=LOWER(${parsed.data.username}) LIMIT 1`;
  const user = rows[0];
  const valid = Boolean(user?.active) && (!user.locked_until || new Date(user.locked_until) < new Date()) && await bcrypt.compare(parsed.data.password, user.password_hash);
  if (!valid) {
    if (user) await db()`UPDATE dashboard_users SET failed_login_attempts=failed_login_attempts+1,locked_until=CASE WHEN failed_login_attempts+1>=5 THEN NOW()+INTERVAL '15 minutes' ELSE locked_until END WHERE id=${user.id}`;
    await db()`INSERT INTO dashboard_audit_log (username,action,success,metadata) VALUES (${parsed.data.username},'FAILED_LOGIN',FALSE,${db().json({ reason: 'invalid_credentials' })})`;
    return NextResponse.json({ error: 'Usuario o contraseña incorrectos.' }, { status: 401 });
  }
  await db()`UPDATE dashboard_users SET failed_login_attempts=0,locked_until=NULL,last_login=NOW() WHERE id=${user.id}`;
  await createSession(user.id);
  await db()`INSERT INTO dashboard_audit_log (user_id,username,action,success) VALUES (${user.id},${user.username},'LOGIN',TRUE)`;
  return NextResponse.json({ ok: true });
}
