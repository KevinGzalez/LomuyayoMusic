import { createHash, randomBytes } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from './db';

export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'OPERATOR' | 'VIEWER';
export type SessionUser = { id: string; username: string; role: Role; mustChangePassword: boolean };
const COOKIE = 'lomuyayo_session';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export async function createSession(userId: string) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + 12 * 60 * 60 * 1000);
  const h = await headers();
  await db()`INSERT INTO dashboard_sessions (user_id,token_hash,expires_at,ip_hash,user_agent) VALUES (${userId},${hash(token)},${expires},${hash(h.get('x-forwarded-for') || 'unknown')},${(h.get('user-agent') || '').slice(0,300)})`;
  (await cookies()).set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', expires });
}

export async function destroySession() {
  const store = await cookies(); const token = store.get(COOKIE)?.value;
  if (token) await db()`DELETE FROM dashboard_sessions WHERE token_hash=${hash(token)}`;
  store.delete(COOKIE);
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const rows = await db()`SELECT u.id,u.username,u.role,u.must_change_password FROM dashboard_sessions s JOIN dashboard_users u ON u.id=s.user_id WHERE s.token_hash=${hash(token)} AND s.expires_at>NOW() AND u.active=TRUE LIMIT 1`;
  const user = rows[0];
  return user ? { id: user.id, username: user.username, role: user.role, mustChangePassword: user.must_change_password } as SessionUser : null;
}

export async function requireUser() { const user = await getSessionUser(); if (!user) redirect('/login'); return user; }
export const can = (role: Role, permission: 'view'|'control'|'manageBot'|'manageUsers') => ({ VIEWER:['view'], OPERATOR:['view','control'], ADMIN:['view','control','manageBot'], SUPER_ADMIN:['view','control','manageBot','manageUsers'] }[role] as string[]).includes(permission);
