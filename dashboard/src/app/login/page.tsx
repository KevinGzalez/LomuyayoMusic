import { Music2 } from 'lucide-react';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { LoginForm } from './login-form';

export default async function LoginPage() {
  if (await getSessionUser()) redirect('/dashboard');
  return <main className="login-page"><section className="login-card"><div className="login-brand"><span><Music2 size={24}/></span><div><b>LOMUYAYO</b><small>MUSIC</small></div></div><p className="kicker">CONTROL CENTER</p><h1>Welcome back</h1><p className="muted">Sign in to manage your music agent.</p><LoginForm/><footer>SECURE CONTROL PLANE · ORACLE AGENT</footer></section></main>;
}
